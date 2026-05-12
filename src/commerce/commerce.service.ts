import { computeComboPricing } from '@catalog/combo-pricing.helper';
import { ComboItemType } from '@catalog/entities/combo-item.entity';
import { Combo, ComboStatus } from '@catalog/entities/combo.entity';
import { Product, ProductStatus } from '@catalog/entities/product.entity';
import { ServiceDependency } from '@catalog/entities/service-dependency.entity';
import { Service, ServiceStatus } from '@catalog/entities/service.entity';
import { EntityManager } from '@mikro-orm/core';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PaymentsService } from '@payments/payments.service';
import { StaffQualification } from '@tenancy/entities/staff-qualification.entity';
import { TenantConfig } from '@tenancy/entities/tenant-config.entity';
import { Tenant } from '@tenancy/entities/tenant.entity';
import { User } from '@tenancy/entities/user.entity';

import {
  AgendaAppointmentDto,
  AgendaResponseDto,
  AgendaStaffEntryDto,
} from './dto/agenda-response.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import {
  CreateBookingDto,
  CreateBookingFulfillment,
  CreateBookingItemDto,
  CreateBookingItemType,
} from './dto/create-booking.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { RescheduleOrderDto } from './dto/reschedule-order.dto';
import { BookingResultDto, RefundPolicyDto, SaleOrderResponseDto } from './dto/sale-order.dto';
import { RefundPolicy } from './entities/refund-policy.entity';
import {
  ComboComponentSnapshot,
  SaleOrderItem,
  SaleOrderItemType,
} from './entities/sale-order-item.entity';
import {
  ACTIVE_BOOKING_STATES,
  SaleOrder,
  SaleOrderFulfillment,
  SaleOrderState,
} from './entities/sale-order.entity';

const noTenantFilter = () => ({ filters: { tenant: false } });

interface ResolvedServiceLine {
  kind: 'service';
  service: Service;
  quantity: 1;
  assignedStaffId?: string;
  unitPrice: number;
  durationMinutes: number;
  slotStart: Date;
  slotEnd: Date;
}

interface ResolvedProductLine {
  kind: 'product';
  product: Product;
  quantity: number;
  unitPrice: number;
}

interface ResolvedComboServiceComponent {
  service: Service;
  durationMinutes: number;
  basePrice: number;
  slotStart: Date;
  slotEnd: Date;
  assignedStaffId?: string;
}

interface ResolvedComboLine {
  kind: 'combo';
  combo: Combo;
  quantity: 1;
  unitPrice: number;
  totalDurationMinutes: number;
  components: Array<
    | ResolvedComboServiceComponent
    | { kind: 'product'; product: Product; basePrice: number; quantity: number }
  >;
  snapshot: ComboComponentSnapshot[];
}

type ResolvedLine = ResolvedServiceLine | ResolvedProductLine | ResolvedComboLine;

@Injectable()
export class CommerceService {
  constructor(
    private readonly em: EntityManager,
    private readonly paymentsService: PaymentsService,
  ) {}

  async createBooking(
    tenantId: string,
    customerId: string,
    dto: CreateBookingDto,
  ): Promise<BookingResultDto> {
    const normalized = await this.normalizeBookingDto(tenantId, dto);

    if (normalized.fulfillment === SaleOrderFulfillment.APPOINTMENT) {
      if (!normalized.scheduledStartAt) {
        throw new BadRequestException('scheduled_start_at is required for appointment fulfillment');
      }
    } else {
      if (normalized.scheduledStartAt) {
        throw new BadRequestException('scheduled_start_at must not be set for pickup fulfillment');
      }
      if (normalized.items.some((i) => i.catalog_item_type !== CreateBookingItemType.PRODUCT)) {
        throw new BadRequestException('pickup orders may only contain products');
      }
    }

    try {
      return await this.em.transactional(async (em) => {
        const customer = await em.findOne(
          User,
          { id: customerId, tenant_id: tenantId },
          noTenantFilter(),
        );
        if (!customer) throw new ForbiddenException('Customer not in tenant');

        const lines = await this.resolveLines(em, tenantId, normalized);

        let hasService = false;
        for (const line of lines) {
          if (line.kind === 'service') hasService = true;
          if (line.kind === 'combo' && line.components.some((c) => 'service' in c)) {
            hasService = true;
          }
        }
        if (normalized.fulfillment === SaleOrderFulfillment.APPOINTMENT && !hasService) {
          throw new BadRequestException(
            'appointment orders must contain at least one service or combo with a service',
          );
        }

        const totalAmount = lines.reduce((acc, l) => acc + lineTotal(l), 0);
        const requiresPayment = totalAmount > 0;

        const order = new SaleOrder();
        order.tenant_id = tenantId;
        order.customer = customer;
        order.fulfillment = normalized.fulfillment;
        order.state = requiresPayment ? SaleOrderState.PENDING_PAYMENT : SaleOrderState.CONFIRMED;
        order.total_amount = totalAmount.toFixed(2);
        order.requires_payment = requiresPayment;
        order.booking_channel = dto.booking_channel;
        order.notes = dto.notes;

        if (normalized.fulfillment === SaleOrderFulfillment.APPOINTMENT) {
          order.scheduled_at = normalized.scheduledStartAt!;
          order.scheduled_end_at = computeAppointmentEnd(normalized.scheduledStartAt!, lines);
          const firstService = findFirstService(lines);
          if (firstService) {
            order.service = firstService.service;
            if (firstService.assignedStaffId) {
              const staff = await em.findOne(
                User,
                { id: firstService.assignedStaffId, tenant_id: tenantId },
                noTenantFilter(),
              );
              if (staff) order.staff = staff;
            }
          }
        }
        em.persist(order);

        for (const line of lines) {
          await this.persistLine(em, tenantId, order, line);
        }

        if (requiresPayment) {
          // Atomic with the order: a provider failure here rolls back the booking.
          const checkout = await this.paymentsService.startCheckout(em, order);
          order.payment_url = checkout.paymentUrl;
        }

        await em.flush();

        return {
          id: order.id,
          requires_payment: requiresPayment,
          payment_url: order.payment_url,
          booking_channel: order.booking_channel ?? null,
          notes: order.notes ?? null,
        };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new UnprocessableEntityException('Slot is no longer available');
      }
      throw err;
    }
  }

  async listMyOrders(
    tenantId: string,
    customerId: string,
    query: ListOrdersQueryDto,
  ): Promise<{
    data: SaleOrderResponseDto[];
    meta: { total: number; page: number; page_size: number };
  }> {
    const page = query.page ?? 1;
    const page_size = query.page_size ?? 50;

    const where: Record<string, unknown> = { tenant_id: tenantId, customer: customerId };
    if (query.state) {
      const states = query.state
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is SaleOrderState =>
          (Object.values(SaleOrderState) as string[]).includes(s),
        );
      if (states.length > 0) where.state = { $in: states };
    }

    const [items, total] = await this.em.findAndCount(SaleOrder, where, {
      orderBy: { created_at: 'desc' },
      limit: page_size,
      offset: (page - 1) * page_size,
      populate: ['service', 'staff'],
      ...noTenantFilter(),
    });

    return {
      data: items.map((o) => this.toOrderDto(o)),
      meta: { total, page, page_size },
    };
  }

  async getOrder(
    tenantId: string,
    customerId: string,
    orderId: string,
  ): Promise<SaleOrderResponseDto> {
    const order = await this.em.findOne(
      SaleOrder,
      { id: orderId, tenant_id: tenantId },
      { populate: ['service', 'staff'], ...noTenantFilter() },
    );
    if (!order) throw new NotFoundException('Order not found');
    if (order.customer.id !== customerId) {
      throw new ForbiddenException('Access denied');
    }
    return this.toOrderDto(order);
  }

  async cancelOrder(
    tenantId: string,
    customerId: string,
    orderId: string,
    dto: CancelOrderDto,
  ): Promise<SaleOrderResponseDto> {
    const order = await this.em.findOne(
      SaleOrder,
      { id: orderId, tenant_id: tenantId },
      { populate: ['service', 'staff'], ...noTenantFilter() },
    );
    if (!order) throw new NotFoundException('Order not found');
    if (order.customer.id !== customerId) {
      throw new ForbiddenException("Cannot cancel another user's order");
    }
    if (
      order.state === SaleOrderState.CANCELLED ||
      order.state === SaleOrderState.COMPLETED ||
      order.state === SaleOrderState.NO_SHOW
    ) {
      throw new BadRequestException('Order cannot be cancelled in its current state');
    }
    order.state = SaleOrderState.CANCELLED;
    order.cancelled_at = new Date();
    order.cancellation_reason = dto.reason;
    await this.em.flush();
    return this.toOrderDto(order);
  }

  async rescheduleOrder(
    tenantId: string,
    customerId: string,
    orderId: string,
    dto: RescheduleOrderDto,
  ): Promise<SaleOrderResponseDto> {
    const newStart = new Date(dto.new_datetime);
    if (Number.isNaN(newStart.getTime())) {
      throw new BadRequestException('Invalid new_datetime');
    }

    const order = await this.em.findOne(
      SaleOrder,
      { id: orderId, tenant_id: tenantId },
      { populate: ['service', 'staff'], ...noTenantFilter() },
    );
    if (!order) throw new NotFoundException('Order not found');
    if (order.customer.id !== customerId) {
      throw new ForbiddenException("Cannot reschedule another user's order");
    }
    if (order.fulfillment !== SaleOrderFulfillment.APPOINTMENT) {
      throw new BadRequestException('Only appointment orders can be rescheduled');
    }
    if (!ACTIVE_BOOKING_STATES.includes(order.state)) {
      throw new BadRequestException('Order cannot be rescheduled in its current state');
    }
    if (!order.service) {
      throw new BadRequestException('Order has no primary service to reschedule');
    }

    const newEnd = new Date(newStart.getTime() + order.service.duration_minutes * 60_000);
    try {
      await this.em
        .getConnection()
        .execute(
          `update sale_orders set scheduled_at = ?, scheduled_end_at = ?, updated_at = now() where id = ? and tenant_id = ?`,
          [newStart, newEnd, orderId, tenantId],
        );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new UnprocessableEntityException('New slot is no longer available');
      }
      throw err;
    }
    order.scheduled_at = newStart;
    order.scheduled_end_at = newEnd;
    return this.toOrderDto(order);
  }

  async markPickedUp(
    tenantId: string,
    customerId: string,
    orderId: string,
  ): Promise<SaleOrderResponseDto> {
    const order = await this.em.findOne(
      SaleOrder,
      { id: orderId, tenant_id: tenantId },
      { populate: ['service', 'staff'], ...noTenantFilter() },
    );
    if (!order) throw new NotFoundException('Order not found');
    if (order.customer.id !== customerId) {
      throw new ForbiddenException("Cannot modify another user's order");
    }
    if (order.fulfillment !== SaleOrderFulfillment.PICKUP) {
      throw new BadRequestException('Only pickup orders can be marked as picked up');
    }
    if (order.state !== SaleOrderState.CONFIRMED) {
      throw new BadRequestException('Pickup order must be confirmed before being picked up');
    }
    order.state = SaleOrderState.COMPLETED;
    order.picked_up_at = new Date();
    await this.em.flush();
    return this.toOrderDto(order);
  }

  async checkIn(tenantId: string, _userId: string, orderId: string): Promise<SaleOrderResponseDto> {
    const order = await this.em.findOne(
      SaleOrder,
      { id: orderId, tenant_id: tenantId },
      { populate: ['service', 'staff'], ...noTenantFilter() },
    );
    if (!order) throw new NotFoundException('Order not found');
    this.assertTransition(order, SaleOrderState.CONFIRMED, SaleOrderState.CHECKED_IN);
    order.state = SaleOrderState.CHECKED_IN;
    order.checked_in_at = new Date();
    await this.em.flush();
    return this.toOrderDto(order);
  }

  async start(tenantId: string, _userId: string, orderId: string): Promise<SaleOrderResponseDto> {
    const order = await this.em.findOne(
      SaleOrder,
      { id: orderId, tenant_id: tenantId },
      { populate: ['service', 'staff'], ...noTenantFilter() },
    );
    if (!order) throw new NotFoundException('Order not found');
    this.assertTransition(order, SaleOrderState.CHECKED_IN, SaleOrderState.IN_PROGRESS);
    order.state = SaleOrderState.IN_PROGRESS;
    order.started_at = new Date();
    await this.em.flush();
    return this.toOrderDto(order);
  }

  async complete(
    tenantId: string,
    _userId: string,
    orderId: string,
  ): Promise<SaleOrderResponseDto> {
    const order = await this.em.findOne(
      SaleOrder,
      { id: orderId, tenant_id: tenantId },
      { populate: ['service', 'staff'], ...noTenantFilter() },
    );
    if (!order) throw new NotFoundException('Order not found');
    this.assertTransition(order, SaleOrderState.IN_PROGRESS, SaleOrderState.PENDING_CHECKOUT);
    order.state = SaleOrderState.PENDING_CHECKOUT;
    order.completed_service_at = new Date();
    await this.em.flush();
    return this.toOrderDto(order);
  }

  async noShow(tenantId: string, _userId: string, orderId: string): Promise<SaleOrderResponseDto> {
    const order = await this.em.findOne(
      SaleOrder,
      { id: orderId, tenant_id: tenantId },
      { populate: ['service', 'staff'], ...noTenantFilter() },
    );
    if (!order) throw new NotFoundException('Order not found');
    this.assertTransition(order, SaleOrderState.CONFIRMED, SaleOrderState.NO_SHOW);
    order.state = SaleOrderState.NO_SHOW;
    order.no_show_at = new Date();
    await this.em.flush();
    return this.toOrderDto(order);
  }

  async listRefundPolicies(tenantId: string): Promise<RefundPolicyDto[]> {
    const policies = await this.em.find(
      RefundPolicy,
      { tenant_id: tenantId, is_active: true },
      { orderBy: { refund_percentage: 'desc' }, ...noTenantFilter() },
    );
    return policies.map((p) => ({
      id: p.id,
      description: p.description,
      refund_percentage: p.refund_percentage,
    }));
  }

  async getAgenda(tenantId: string, date: string): Promise<AgendaResponseDto> {
    const tzRow = await this.em.findOne(
      TenantConfig,
      { tenant_id: tenantId, key: 'timezone' },
      noTenantFilter(),
    );
    const timezone = tzRow?.value ?? 'America/Sao_Paulo';

    const dayOfWeek = localDayOfWeek(date);

    // Load non-cancelled appointment orders for the local date (timezone-aware)
    const orderIdRows = (await this.em
      .getConnection()
      .execute(
        `SELECT id FROM sale_orders WHERE tenant_id = ? AND state != ? AND scheduled_at IS NOT NULL AND (scheduled_at AT TIME ZONE ?)::date = ?::date`,
        [tenantId, SaleOrderState.CANCELLED, timezone, date],
      )) as Array<{ id: string }>;

    const orderIds = orderIdRows.map((r) => r.id);

    const orders =
      orderIds.length > 0
        ? await this.em.find(
            SaleOrder,
            { id: { $in: orderIds } },
            { populate: ['customer', 'items.service', 'staff'], ...noTenantFilter() },
          )
        : [];

    // Load staff schedules for the day of week
    const scheduleRows = (await this.em
      .getConnection()
      .execute(
        `SELECT user_id, start_time, end_time FROM staff_schedules WHERE tenant_id = ? AND day_of_week = ?`,
        [tenantId, dayOfWeek],
      )) as Array<{ user_id: string; start_time: string; end_time: string }>;

    // Collect all staff IDs from schedules + from orders (drift)
    const scheduleStaffIds = new Set(scheduleRows.map((r) => r.user_id));
    const orderStaffIds = new Set(orders.filter((o) => o.staff?.id).map((o) => o.staff!.id));
    const allStaffIds = [...new Set([...scheduleStaffIds, ...orderStaffIds])];

    const staffUsers =
      allStaffIds.length > 0
        ? await this.em.find(
            User,
            { id: { $in: allStaffIds }, tenant_id: tenantId },
            noTenantFilter(),
          )
        : [];

    // Group orders by staff_id
    const assignedOrders = new Map<string, SaleOrder[]>();
    const unassignedOrders: SaleOrder[] = [];

    for (const order of orders) {
      const staffId = order.staff?.id;
      if (staffId) {
        const bucket = assignedOrders.get(staffId) ?? [];
        bucket.push(order);
        assignedOrders.set(staffId, bucket);
      } else {
        unassignedOrders.push(order);
      }
    }

    const staff: AgendaStaffEntryDto[] = allStaffIds.map((staffId) => {
      const user = staffUsers.find((u) => u.id === staffId);
      const schedule = scheduleRows.find((s) => s.user_id === staffId);
      const staffOrderList = assignedOrders.get(staffId) ?? [];
      const appointments = staffOrderList.map(toAppointmentDto);
      return {
        id: staffId,
        name: user?.full_name ?? '',
        schedule_start: schedule ? trimTime(schedule.start_time) : null,
        schedule_end: schedule ? trimTime(schedule.end_time) : null,
        appointment_count: appointments.length,
        appointments,
      };
    });

    return { staff, unassigned: unassignedOrders.map(toAppointmentDto) };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  assertTransition(order: SaleOrder, from: SaleOrderState, to: SaleOrderState): void {
    if (order.state !== from) {
      throw new ConflictException(
        `Cannot transition to ${to}: order is in state ${order.state}, expected ${from}`,
      );
    }
  }

  private async normalizeBookingDto(
    tenantId: string,
    dto: CreateBookingDto,
  ): Promise<{
    fulfillment: SaleOrderFulfillment;
    scheduledStartAt?: Date;
    items: CreateBookingItemDto[];
    legacyAutoPickStaff: boolean;
  }> {
    if (dto.shop_slug) {
      const tenant = await this.em.findOne(
        Tenant,
        { id: tenantId, slug: dto.shop_slug },
        { filters: false },
      );
      if (!tenant) throw new BadRequestException('shop_slug does not match tenant');
    }

    const isLegacy =
      !dto.fulfillment && !dto.items && !!dto.service_id && !!dto.date && !!dto.start_time;

    if (isLegacy) {
      const startAt = new Date(`${dto.date!}T${dto.start_time!}:00.000Z`);
      if (Number.isNaN(startAt.getTime())) {
        throw new BadRequestException('Invalid date/time');
      }
      const items: CreateBookingItemDto[] = [
        {
          catalog_item_type: CreateBookingItemType.SERVICE,
          catalog_item_id: dto.service_id!,
          quantity: 1,
          assigned_staff_id: dto.staff_id,
        },
      ];
      return {
        fulfillment: SaleOrderFulfillment.APPOINTMENT,
        scheduledStartAt: startAt,
        items,
        legacyAutoPickStaff: !dto.staff_id,
      };
    }

    if (!dto.fulfillment || !dto.items) {
      throw new BadRequestException(
        'fulfillment and items are required (or legacy {service_id,date,start_time})',
      );
    }

    const fulfillment =
      dto.fulfillment === CreateBookingFulfillment.APPOINTMENT
        ? SaleOrderFulfillment.APPOINTMENT
        : SaleOrderFulfillment.PICKUP;

    let scheduledStartAt: Date | undefined;
    if (dto.scheduled_start_at) {
      scheduledStartAt = new Date(dto.scheduled_start_at);
      if (Number.isNaN(scheduledStartAt.getTime())) {
        throw new BadRequestException('Invalid scheduled_start_at');
      }
    }
    return {
      fulfillment,
      scheduledStartAt,
      items: dto.items,
      legacyAutoPickStaff: false,
    };
  }

  private async resolveLines(
    em: EntityManager,
    tenantId: string,
    normalized: {
      fulfillment: SaleOrderFulfillment;
      scheduledStartAt?: Date;
      items: CreateBookingItemDto[];
      legacyAutoPickStaff: boolean;
    },
  ): Promise<ResolvedLine[]> {
    const lines: ResolvedLine[] = [];
    let cursorMinutes = 0;

    for (const item of normalized.items) {
      if (item.catalog_item_type === CreateBookingItemType.SERVICE) {
        const service = await em.findOne(
          Service,
          { id: item.catalog_item_id, tenant_id: tenantId, status: ServiceStatus.ACTIVE },
          noTenantFilter(),
        );
        if (!service) throw new NotFoundException(`Service ${item.catalog_item_id} not found`);
        if (item.quantity !== 1) {
          throw new BadRequestException('Service lines must have quantity = 1');
        }
        const slotStart = new Date(normalized.scheduledStartAt!.getTime() + cursorMinutes * 60_000);
        const slotEnd = new Date(slotStart.getTime() + service.duration_minutes * 60_000);
        const assignedStaffId = await this.resolveStaffForService(
          em,
          tenantId,
          service.id,
          item.assigned_staff_id,
          slotStart,
          slotEnd,
          normalized.legacyAutoPickStaff,
        );
        lines.push({
          kind: 'service',
          service,
          quantity: 1,
          assignedStaffId,
          unitPrice: Number(service.base_price),
          durationMinutes: service.duration_minutes,
          slotStart,
          slotEnd,
        });
        cursorMinutes += service.duration_minutes;
      } else if (item.catalog_item_type === CreateBookingItemType.PRODUCT) {
        const product = await em.findOne(
          Product,
          { id: item.catalog_item_id, tenant_id: tenantId, status: ProductStatus.ACTIVE },
          noTenantFilter(),
        );
        if (!product) throw new NotFoundException(`Product ${item.catalog_item_id} not found`);
        if (item.quantity < 1) {
          throw new BadRequestException('Product quantity must be >= 1');
        }
        lines.push({
          kind: 'product',
          product,
          quantity: item.quantity,
          unitPrice: Number(product.base_price),
        });
      } else {
        // combo
        const combo = await em.findOne(
          Combo,
          { id: item.catalog_item_id, tenant_id: tenantId, status: ComboStatus.ACTIVE },
          { populate: ['items.service', 'items.product'], ...noTenantFilter() },
        );
        if (!combo) throw new NotFoundException(`Combo ${item.catalog_item_id} not found`);
        if (item.quantity !== 1) {
          throw new BadRequestException('Combo lines must have quantity = 1');
        }

        const pricing = computeComboPricing(combo);
        const components: ResolvedComboLine['components'] = [];
        const snapshot: ComboComponentSnapshot[] = [];

        for (const comboItem of combo.items.getItems()) {
          if (comboItem.item_type === ComboItemType.SERVICE) {
            const svc = comboItem.service!;
            const slotStart = new Date(
              normalized.scheduledStartAt!.getTime() + cursorMinutes * 60_000,
            );
            const slotEnd = new Date(slotStart.getTime() + svc.duration_minutes * 60_000);
            const assignedStaffId = await this.resolveStaffForService(
              em,
              tenantId,
              svc.id,
              item.assigned_staff_id,
              slotStart,
              slotEnd,
              false,
            );
            components.push({
              service: svc,
              durationMinutes: svc.duration_minutes,
              basePrice: Number(svc.base_price),
              slotStart,
              slotEnd,
              assignedStaffId,
            });
            snapshot.push({
              catalog_item_type: 'service',
              catalog_item_id: svc.id,
              name: svc.name,
              base_price: Number(svc.base_price),
              duration_minutes: svc.duration_minutes,
              quantity: 1,
              assigned_staff_id: assignedStaffId,
              slot_start_at: slotStart.toISOString(),
              slot_end_at: slotEnd.toISOString(),
            });
            cursorMinutes += svc.duration_minutes;
          } else {
            const prod = comboItem.product!;
            components.push({
              kind: 'product',
              product: prod,
              basePrice: Number(prod.base_price),
              quantity: 1,
            });
            snapshot.push({
              catalog_item_type: 'product',
              catalog_item_id: prod.id,
              name: prod.name,
              base_price: Number(prod.base_price),
              quantity: 1,
            });
          }
        }

        lines.push({
          kind: 'combo',
          combo,
          quantity: 1,
          unitPrice: pricing.total,
          totalDurationMinutes: pricing.total_duration_minutes,
          components,
          snapshot,
        });
      }
    }

    return lines;
  }

  private async resolveStaffForService(
    em: EntityManager,
    tenantId: string,
    serviceId: string,
    requestedStaffId: string | undefined,
    slotStart: Date,
    slotEnd: Date,
    autoPickIfMissing: boolean,
  ): Promise<string | undefined> {
    if (requestedStaffId) {
      const qual = await em.findOne(
        StaffQualification,
        { tenant_id: tenantId, service: serviceId, user: requestedStaffId },
        noTenantFilter(),
      );
      if (!qual) {
        throw new UnprocessableEntityException('Staff is not qualified for this service');
      }
      const free = await this.isStaffFreeAt(em, tenantId, requestedStaffId, slotStart, slotEnd);
      if (!free) {
        throw new UnprocessableEntityException('Staff is not free at the requested slot');
      }
      return requestedStaffId;
    }

    if (!autoPickIfMissing) {
      // pending pool — leave unassigned
      return undefined;
    }

    const qualRows = (await em
      .getConnection()
      .execute(`select user_id from staff_qualifications where tenant_id = ? and service_id = ?`, [
        tenantId,
        serviceId,
      ])) as Array<{ user_id: string }>;
    const candidateIds = qualRows.map((r) => r.user_id);
    if (candidateIds.length === 0) {
      throw new UnprocessableEntityException('No qualified staff for this service');
    }
    for (const sid of candidateIds) {
      if (await this.isStaffFreeAt(em, tenantId, sid, slotStart, slotEnd)) return sid;
    }
    throw new UnprocessableEntityException('Slot is not available');
  }

  private async isStaffFreeAt(
    em: EntityManager,
    tenantId: string,
    staffId: string,
    slotStart: Date,
    slotEnd: Date,
  ): Promise<boolean> {
    const dow = slotStart.getUTCDay();
    const startM = slotStart.getUTCHours() * 60 + slotStart.getUTCMinutes();
    const endM = startM + Math.round((slotEnd.getTime() - slotStart.getTime()) / 60_000);

    const schedules = (await em
      .getConnection()
      .execute(
        `select day_of_week, start_time, end_time from staff_schedules where tenant_id = ? and user_id = ?`,
        [tenantId, staffId],
      )) as Array<{ day_of_week: number; start_time: string; end_time: string }>;
    const fits = schedules.some(
      (s) =>
        s.day_of_week === dow &&
        timeToMinutes(s.start_time) <= startM &&
        timeToMinutes(s.end_time) >= endM,
    );
    if (!fits) return false;

    const activePlaceholders = ACTIVE_BOOKING_STATES.map(() => '?').join(',');
    const orderLevelBusy = (await em
      .getConnection()
      .execute(
        `select 1 from sale_orders where tenant_id = ? and staff_id = ? and state in (${activePlaceholders}) and scheduled_at < ? and scheduled_end_at > ?`,
        [tenantId, staffId, ...ACTIVE_BOOKING_STATES, slotEnd, slotStart],
      )) as unknown[];
    if (orderLevelBusy.length > 0) return false;

    const itemLevelBusy = (await em.getConnection().execute(
      `select 1 from sale_order_items i
         join sale_orders so on so.id = i.sale_order_id
         where i.tenant_id = ? and i.assigned_staff_id = ? and so.state in (${activePlaceholders})
           and i.slot_start_at < ? and i.slot_end_at > ?`,
      [tenantId, staffId, ...ACTIVE_BOOKING_STATES, slotEnd, slotStart],
    )) as unknown[];
    return itemLevelBusy.length === 0;
  }

  private async persistLine(
    em: EntityManager,
    tenantId: string,
    order: SaleOrder,
    line: ResolvedLine,
  ): Promise<void> {
    const item = new SaleOrderItem();
    item.tenant_id = tenantId;
    item.sale_order = order;
    item.is_dependency = false;

    if (line.kind === 'service') {
      item.catalog_item_type = SaleOrderItemType.SERVICE;
      item.catalog_item_id = line.service.id;
      item.service = line.service;
      item.quantity = 1;
      item.price = line.unitPrice.toFixed(2);
      item.slot_start_at = line.slotStart;
      item.slot_end_at = line.slotEnd;
      if (line.assignedStaffId) {
        const staff = em.getReference(User, line.assignedStaffId);
        item.assigned_staff = staff;
      }
      em.persist(item);
      await this.persistAutoIncludedDependencies(
        em,
        tenantId,
        order,
        line.service.id,
        line.slotStart,
        line.slotEnd,
        line.assignedStaffId,
      );
    } else if (line.kind === 'product') {
      item.catalog_item_type = SaleOrderItemType.PRODUCT;
      item.catalog_item_id = line.product.id;
      item.product = line.product;
      item.quantity = line.quantity;
      item.price = line.unitPrice.toFixed(2);
      em.persist(item);
    } else {
      item.catalog_item_type = SaleOrderItemType.COMBO;
      item.catalog_item_id = line.combo.id;
      item.combo = line.combo;
      item.quantity = 1;
      item.price = line.unitPrice.toFixed(2);
      item.combo_components = line.snapshot;
      em.persist(item);
      for (const c of line.components) {
        if ('service' in c) {
          await this.persistAutoIncludedDependencies(
            em,
            tenantId,
            order,
            c.service.id,
            c.slotStart,
            c.slotEnd,
            c.assignedStaffId,
          );
        }
      }
    }
  }

  private async persistAutoIncludedDependencies(
    em: EntityManager,
    tenantId: string,
    order: SaleOrder,
    serviceId: string,
    slotStart: Date,
    slotEnd: Date,
    assignedStaffId: string | undefined,
  ): Promise<void> {
    const dependencies = await em.find(
      ServiceDependency,
      { tenant_id: tenantId, service: serviceId, auto_include: true },
      { populate: ['depends_on_service'], ...noTenantFilter() },
    );
    for (const dep of dependencies) {
      const item = new SaleOrderItem();
      item.tenant_id = tenantId;
      item.sale_order = order;
      item.catalog_item_type = SaleOrderItemType.SERVICE;
      item.catalog_item_id = dep.depends_on_service.id;
      item.service = dep.depends_on_service;
      item.quantity = 1;
      item.price = '0.00';
      item.is_dependency = true;
      item.slot_start_at = slotStart;
      item.slot_end_at = slotEnd;
      if (assignedStaffId) {
        item.assigned_staff = em.getReference(User, assignedStaffId);
      }
      em.persist(item);
    }
  }

  private toOrderDto(o: SaleOrder): SaleOrderResponseDto {
    return {
      id: o.id,
      state: o.state,
      fulfillment: o.fulfillment === SaleOrderFulfillment.APPOINTMENT ? 'appointment' : 'pickup',
      scheduled_at: o.scheduled_at?.toISOString(),
      service_name: o.service?.name,
      professional_name: o.staff?.full_name,
      total_amount: Number(o.total_amount),
      picked_up_at: o.picked_up_at?.toISOString(),
      booking_channel: o.booking_channel ?? null,
      notes: o.notes ?? null,
      created_at: o.created_at.toISOString(),
    };
  }
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function isUniqueViolation(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const code = (err as { code?: string }).code;
    if (code === '23505') return true;
    const cause = (err as { cause?: unknown }).cause;
    if (cause && typeof cause === 'object' && (cause as { code?: string }).code === '23505') {
      return true;
    }
  }
  return false;
}

function lineTotal(line: ResolvedLine): number {
  if (line.kind === 'service') return line.unitPrice;
  if (line.kind === 'product') return line.unitPrice * line.quantity;
  return line.unitPrice;
}

function findFirstService(
  lines: ResolvedLine[],
): { service: Service; assignedStaffId?: string } | undefined {
  for (const line of lines) {
    if (line.kind === 'service') {
      return { service: line.service, assignedStaffId: line.assignedStaffId };
    }
    if (line.kind === 'combo') {
      for (const c of line.components) {
        if ('service' in c) {
          return { service: c.service, assignedStaffId: c.assignedStaffId };
        }
      }
    }
  }
  return undefined;
}

function computeAppointmentEnd(start: Date, lines: ResolvedLine[]): Date {
  let totalMinutes = 0;
  for (const line of lines) {
    if (line.kind === 'service') totalMinutes += line.durationMinutes;
    else if (line.kind === 'combo') totalMinutes += line.totalDurationMinutes;
  }
  return new Date(start.getTime() + totalMinutes * 60_000);
}

function localDayOfWeek(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
}

// Normalise HH:MM:SS storage format (from Postgres `time` column) to HH:MM
function trimTime(t: string): string {
  return t.slice(0, 5);
}

function toAppointmentDto(order: SaleOrder): AgendaAppointmentDto {
  const serviceNames = order.items
    .getItems()
    .filter((i) => i.catalog_item_type === SaleOrderItemType.SERVICE && !i.is_dependency)
    .map((i) => i.service?.name)
    .filter((n): n is string => Boolean(n))
    .join(', ');

  const durationMinutes =
    order.scheduled_at && order.scheduled_end_at
      ? Math.round((order.scheduled_end_at.getTime() - order.scheduled_at.getTime()) / 60_000)
      : null;

  return {
    id: order.id,
    customer_name: order.customer.full_name,
    customer_phone: order.customer.phone ?? null,
    customer_email: order.customer.email,
    services: serviceNames,
    scheduled_start_at: order.scheduled_at!.toISOString(),
    scheduled_end_at: order.scheduled_end_at?.toISOString() ?? null,
    duration_minutes: durationMinutes,
    state: order.state,
    total: Number(order.total_amount),
    booking_channel: order.booking_channel ?? null,
    created_at: order.created_at.toISOString(),
    notes: order.notes ?? null,
  };
}
