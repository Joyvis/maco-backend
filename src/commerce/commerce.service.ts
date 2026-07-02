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
import { QualifiedStaff } from '@scheduling/dto/availability.dto';
import { SchedulingService } from '@scheduling/scheduling.service';
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
import {
  BookingQuoteDto,
  BookingQuoteLineDto,
  BookingResultDto,
  RefundPolicyDto,
  SaleOrderItemDto,
  SaleOrderResponseDto,
} from './dto/sale-order.dto';
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

const ORDER_POPULATE = ['service', 'staff', 'items', 'items.assigned_staff'] as const;

const STAFF_ROLES = new Set(['owner', 'ta']);
const isStaff = (roles?: readonly string[]) => Boolean(roles?.some((r) => STAFF_ROLES.has(r)));

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

interface ResolvedAutoIncludeDep {
  dependencyService: Service;
  slotStart: Date;
  slotEnd: Date;
  assignedStaffId?: string;
}

@Injectable()
export class CommerceService {
  constructor(
    private readonly em: EntityManager,
    private readonly paymentsService: PaymentsService,
    private readonly schedulingService: SchedulingService,
  ) {}

  async createBooking(
    tenantId: string,
    requesterId: string,
    dto: CreateBookingDto,
    requesterRoles: readonly string[] = [],
  ): Promise<BookingResultDto> {
    // Staff (owner/ta) may book on behalf of a customer by sending
    // `customer_id`; the order is then attached to that customer, not to the
    // requester. Customers can only book for themselves.
    const isOnBehalf = Boolean(dto.customer_id) && dto.customer_id !== requesterId;
    if (isOnBehalf && !isStaff(requesterRoles)) {
      throw new ForbiddenException('Only staff can book on behalf of a customer');
    }
    const customerId = dto.customer_id ?? requesterId;

    const normalized = await this.normalizeBookingDto(tenantId, dto);
    this.assertFulfillmentInvariants(normalized);

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
        // Online checkout applies to self-service bookings only. Staff-created
        // (on-behalf) bookings are settled in person through the existing
        // completion flow (in_progress → pending_checkout), so they are
        // confirmed immediately and never get a payment link.
        const requiresPayment = totalAmount > 0 && !isOnBehalf;

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
          this.persistLine(em, tenantId, order, line);
        }

        // Auto-include deps are resolved against the full line set so a dep
        // already covered by the cart (e.g. Lavagem inside a combo) isn't
        // persisted as a phantom row. This is the same list the quote
        // endpoint returned to the FE.
        const deps = await this.resolveAutoIncludeDepsForLines(em, tenantId, lines);
        for (const dep of deps) {
          this.persistAutoIncludeDep(em, tenantId, order, dep);
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
          scheduled_start_at: order.scheduled_at?.toISOString() ?? null,
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

  // Stateless price/duration preview for the booking review screen. Same
  // pipeline as `createBooking` (normalize → resolveLines → auto-include
  // deps), minus persistence — so the FE can render canonical totals on the
  // confirmation step instead of computing them locally and risking drift
  // against the value the user is then charged. The invariant is:
  //   `quoteBooking(payload).total_amount === createBooking(payload).total_amount`.
  // Read-only; no transaction. Honours the same validation errors so the FE
  // can surface them before submit.
  async quoteBooking(
    tenantId: string,
    customerId: string,
    dto: CreateBookingDto,
  ): Promise<BookingQuoteDto> {
    const normalized = await this.normalizeBookingDto(tenantId, dto);
    this.assertFulfillmentInvariants(normalized);

    const customer = await this.em.findOne(
      User,
      { id: customerId, tenant_id: tenantId },
      noTenantFilter(),
    );
    if (!customer) throw new ForbiddenException('Customer not in tenant');

    const lines = await this.resolveLines(this.em, tenantId, normalized);

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

    const deps = await this.resolveAutoIncludeDepsForLines(this.em, tenantId, lines);

    const staffNameById = await this.loadStaffNamesForQuote(tenantId, lines, deps);

    const totalAmount = lines.reduce((acc, l) => acc + lineTotal(l), 0);
    const totalDurationMinutes = sumLinesDuration(lines);
    const scheduledEndAt =
      normalized.fulfillment === SaleOrderFulfillment.APPOINTMENT && normalized.scheduledStartAt
        ? computeAppointmentEnd(normalized.scheduledStartAt, lines)
        : undefined;

    const quoteLines: BookingQuoteLineDto[] = [];
    for (const line of lines) {
      quoteLines.push(toQuoteLine(line, staffNameById));
    }
    for (const dep of deps) {
      quoteLines.push({
        catalog_item_type: 'service',
        catalog_item_id: dep.dependencyService.id,
        name: dep.dependencyService.name,
        quantity: 1,
        unit_price: 0,
        line_total: 0,
        duration_minutes: dep.dependencyService.duration_minutes,
        is_dependency: true,
        assigned_staff_id: dep.assignedStaffId,
        assigned_staff_name: dep.assignedStaffId
          ? staffNameById.get(dep.assignedStaffId)
          : undefined,
        slot_start_at: dep.slotStart.toISOString(),
        slot_end_at: dep.slotEnd.toISOString(),
      });
    }

    return {
      fulfillment:
        normalized.fulfillment === SaleOrderFulfillment.APPOINTMENT ? 'appointment' : 'pickup',
      scheduled_start_at: normalized.scheduledStartAt?.toISOString(),
      scheduled_end_at: scheduledEndAt?.toISOString(),
      total_duration_minutes: totalDurationMinutes,
      total_amount: Number(totalAmount.toFixed(2)),
      lines: quoteLines,
    };
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
      populate: ORDER_POPULATE,
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
      { populate: ORDER_POPULATE, ...noTenantFilter() },
    );
    if (!order) throw new NotFoundException('Order not found');
    if (order.customer.id !== customerId) {
      throw new ForbiddenException('Access denied');
    }
    return this.toOrderDto(order);
  }

  async cancelOrder(
    tenantId: string,
    callerId: string,
    callerRoles: readonly string[],
    orderId: string,
    dto: CancelOrderDto,
  ): Promise<SaleOrderResponseDto> {
    const order = await this.em.findOne(
      SaleOrder,
      { id: orderId, tenant_id: tenantId },
      { populate: ORDER_POPULATE, ...noTenantFilter() },
    );
    if (!order) throw new NotFoundException('Order not found');
    if (order.customer.id !== callerId && !isStaff(callerRoles)) {
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
    callerId: string,
    callerRoles: readonly string[],
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
      { populate: ORDER_POPULATE, ...noTenantFilter() },
    );
    if (!order) throw new NotFoundException('Order not found');
    if (order.customer.id !== callerId && !isStaff(callerRoles)) {
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
      { populate: ORDER_POPULATE, ...noTenantFilter() },
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
      { populate: ORDER_POPULATE, ...noTenantFilter() },
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
      { populate: ORDER_POPULATE, ...noTenantFilter() },
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
      { populate: ORDER_POPULATE, ...noTenantFilter() },
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
      { populate: ORDER_POPULATE, ...noTenantFilter() },
    );
    if (!order) throw new NotFoundException('Order not found');
    this.assertTransition(order, SaleOrderState.CONFIRMED, SaleOrderState.NO_SHOW);
    order.state = SaleOrderState.NO_SHOW;
    order.no_show_at = new Date();
    await this.em.flush();
    return this.toOrderDto(order);
  }

  // Staff swap candidates for one agenda block — the items currently assigned
  // to `fromStaffId`. Intersects "qualified for THAT subset of services" with
  // "free across the subset's slot window", excluding the order itself from
  // the conflict scan (otherwise the source staff would always look busy) and
  // every staff currently holding ANY of the subset's items from the result
  // (a no-op swap is not a swap). Returns an empty list when the source staff
  // has no service items on this order.
  async listEligibleStaffForChange(
    tenantId: string,
    orderId: string,
    fromStaffId: string,
  ): Promise<QualifiedStaff[]> {
    const order = await this.loadOrderForStaffChange(tenantId, orderId);
    const sourceItems = this.serviceItemsAssignedTo(order, fromStaffId);
    if (sourceItems.length === 0) return [];

    const window = this.itemsSlotWindow(order, sourceItems);
    const serviceIds = this.itemsServiceIds(sourceItems);
    const currentStaffIds = this.itemsAssignedStaffIds(sourceItems);

    const eligible = await this.schedulingService.getEligibleStaffForSlot(
      tenantId,
      serviceIds,
      window.start,
      window.end,
      orderId,
    );
    return eligible.filter((s) => !currentStaffIds.has(s.user_id));
  }

  // Reassign only the service items currently held by `fromStaffId` to
  // `staffId` — items belonging to other staff on the same multi-staff order
  // are untouched. Qualification + availability are validated against that
  // subset only (the target may legitimately not be qualified for items on
  // OTHER staff of the order). The order-level `staff` mirror only follows
  // when the source staff was the mirrored one.
  async changeStaff(
    tenantId: string,
    callerId: string,
    callerRoles: readonly string[],
    orderId: string,
    fromStaffId: string,
    staffId: string,
  ): Promise<SaleOrderResponseDto> {
    if (!isStaff(callerRoles)) {
      throw new ForbiddenException('Only staff can change appointment professional');
    }
    if (fromStaffId === staffId) {
      throw new BadRequestException('Source and target staff must differ');
    }

    const order = await this.loadOrderForStaffChange(tenantId, orderId);
    if (!ACTIVE_BOOKING_STATES.includes(order.state)) {
      throw new BadRequestException('Order cannot be modified in its current state');
    }

    const sourceItems = this.serviceItemsAssignedTo(order, fromStaffId);
    if (sourceItems.length === 0) {
      throw new BadRequestException('Source staff has no service items on this order');
    }

    const window = this.itemsSlotWindow(order, sourceItems);
    const serviceIds = this.itemsServiceIds(sourceItems);

    const eligible = await this.schedulingService.getEligibleStaffForSlot(
      tenantId,
      serviceIds,
      window.start,
      window.end,
      orderId,
    );
    if (!eligible.some((s) => s.user_id === staffId)) {
      throw new UnprocessableEntityException(
        'Staff is not qualified or not available for this slot',
      );
    }

    const staff = this.em.getReference(User, staffId);
    for (const item of sourceItems) {
      item.assigned_staff = staff;
    }
    if (order.staff?.id === fromStaffId) {
      order.staff = staff;
    }
    await this.em.flush();
    return this.toOrderDto(order);
  }

  private async loadOrderForStaffChange(tenantId: string, orderId: string): Promise<SaleOrder> {
    const order = await this.em.findOne(
      SaleOrder,
      { id: orderId, tenant_id: tenantId },
      {
        // `items.service` is not in ORDER_POPULATE (existing callers don't
        // need it), but the swap path reads each item's service to compute
        // the qualified-staff intersection.
        populate: [...ORDER_POPULATE, 'items.service'],
        ...noTenantFilter(),
      },
    );
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  // Service items on `order` currently held by `staffId`. The order-level
  // `staff_id` mirror is consulted as a fallback for legacy items whose own
  // `assigned_staff` was never set (pre-multi-staff bookings).
  private serviceItemsAssignedTo(order: SaleOrder, staffId: string): SaleOrderItem[] {
    const matches: SaleOrderItem[] = [];
    for (const item of order.items.getItems()) {
      if (item.catalog_item_type !== SaleOrderItemType.SERVICE) continue;
      const effective = item.assigned_staff?.id ?? order.staff?.id ?? null;
      if (effective === staffId) matches.push(item);
    }
    return matches;
  }

  private itemsServiceIds(items: SaleOrderItem[]): string[] {
    const ids: string[] = [];
    for (const item of items) {
      if (item.service) ids.push(item.service.id);
    }
    return ids;
  }

  private itemsAssignedStaffIds(items: SaleOrderItem[]): Set<string> {
    const ids = new Set<string>();
    for (const item of items) {
      if (item.assigned_staff) ids.add(item.assigned_staff.id);
    }
    return ids;
  }

  // Slot window across `items`: MIN(slot_start_at) → MAX(slot_end_at), falling
  // back to the order-level scheduled_at/end_at for legacy items that
  // pre-date per-item slots.
  private itemsSlotWindow(order: SaleOrder, items: SaleOrderItem[]): { start: Date; end: Date } {
    const starts: Date[] = [];
    const ends: Date[] = [];
    for (const item of items) {
      if (item.slot_start_at) starts.push(item.slot_start_at);
      if (item.slot_end_at) ends.push(item.slot_end_at);
    }
    const start =
      starts.length > 0
        ? new Date(Math.min(...starts.map((d) => d.getTime())))
        : order.scheduled_at;
    const end =
      ends.length > 0
        ? new Date(Math.max(...ends.map((d) => d.getTime())))
        : order.scheduled_end_at;
    if (!start || !end) {
      throw new BadRequestException('Order has no scheduled window');
    }
    return { start, end };
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
            {
              populate: ['customer', 'items.service', 'items.assigned_staff', 'staff'],
              ...noTenantFilter(),
            },
          )
        : [];

    // Load staff schedules for the day of week
    const scheduleRows = (await this.em
      .getConnection()
      .execute(
        `SELECT user_id, start_time, end_time FROM staff_schedules WHERE tenant_id = ? AND day_of_week = ?`,
        [tenantId, dayOfWeek],
      )) as Array<{ user_id: string; start_time: string; end_time: string }>;

    // Bucket items per (effective staff, order). Effective staff is the item's
    // own assigned_staff, falling back to the order's order-level staff for
    // legacy/non-cart bookings that only set a top-level staff_id. An order
    // with two items assigned to two distinct staff produces two entries —
    // one under each staff's column — each carrying only that staff's items.
    const itemBuckets = new Map<string, Map<string, SaleOrderItem[]>>();
    const unassignedBuckets = new Map<string, SaleOrderItem[]>();

    for (const order of orders) {
      for (const item of order.items.getItems()) {
        const effectiveStaffId = item.assigned_staff?.id ?? order.staff?.id ?? null;
        if (effectiveStaffId) {
          const perStaff = itemBuckets.get(effectiveStaffId) ?? new Map<string, SaleOrderItem[]>();
          const perOrder = perStaff.get(order.id) ?? [];
          perOrder.push(item);
          perStaff.set(order.id, perOrder);
          itemBuckets.set(effectiveStaffId, perStaff);
        } else {
          const perOrder = unassignedBuckets.get(order.id) ?? [];
          perOrder.push(item);
          unassignedBuckets.set(order.id, perOrder);
        }
      }
    }

    // Collect all staff IDs from schedules + from any item-derived bucket (drift)
    const scheduleStaffIds = new Set(scheduleRows.map((r) => r.user_id));
    const orderStaffIds = new Set(itemBuckets.keys());
    const allStaffIds = [...new Set([...scheduleStaffIds, ...orderStaffIds])];

    const staffUsers =
      allStaffIds.length > 0
        ? await this.em.find(
            User,
            { id: { $in: allStaffIds }, tenant_id: tenantId },
            noTenantFilter(),
          )
        : [];

    const ordersById = new Map(orders.map((o) => [o.id, o]));

    const staff: AgendaStaffEntryDto[] = allStaffIds.map((staffId) => {
      const user = staffUsers.find((u) => u.id === staffId);
      // A staff's day is stored as one or more schedule blocks (e.g. a morning
      // and an afternoon split around lunch). The agenda window must span the
      // whole working day, so aggregate the earliest start and latest end
      // across every block — never just the first one, which would clip the
      // grid to the morning and render it half-height.
      const blocks = scheduleRows.filter((s) => s.user_id === staffId);
      const scheduleStart =
        blocks.length > 0
          ? blocks.reduce(
              (min, b) => (b.start_time < min ? b.start_time : min),
              blocks[0].start_time,
            )
          : null;
      const scheduleEnd =
        blocks.length > 0
          ? blocks.reduce((max, b) => (b.end_time > max ? b.end_time : max), blocks[0].end_time)
          : null;
      const perOrder = itemBuckets.get(staffId);
      const appointments: AgendaAppointmentDto[] = perOrder
        ? [...perOrder.entries()].map(([orderId, items]) =>
            toAppointmentDtoForItems(ordersById.get(orderId)!, items),
          )
        : [];
      return {
        id: staffId,
        name: user?.full_name ?? '',
        schedule_start: scheduleStart ? trimTime(scheduleStart) : null,
        schedule_end: scheduleEnd ? trimTime(scheduleEnd) : null,
        appointment_count: appointments.length,
        appointments,
      };
    });

    const unassigned: AgendaAppointmentDto[] = [...unassignedBuckets.entries()].map(
      ([orderId, items]) => toAppointmentDtoForItems(ordersById.get(orderId)!, items),
    );

    return { staff, unassigned };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private assertFulfillmentInvariants(normalized: {
    fulfillment: SaleOrderFulfillment;
    scheduledStartAt?: Date;
    items: CreateBookingItemDto[];
  }): void {
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
  }

  // Resolves the set of auto-include dependencies for these lines, de-duped
  // against services the user already has (top-level service line OR combo
  // service component) and against deps already collected for an earlier
  // line. Used by both `quoteBooking` (render the deps as `incluído` rows)
  // and `createBooking` (persist them at price=0) so the two views agree.
  // Without de-dup, picking the "Corte + Lavagem" combo would surface a
  // phantom "Lavagem (incluído)" row below the combo since Corte's
  // auto-include dep points at the Lavagem service the combo already covers.
  private async resolveAutoIncludeDepsForLines(
    em: EntityManager,
    tenantId: string,
    lines: ResolvedLine[],
  ): Promise<ResolvedAutoIncludeDep[]> {
    const presentServiceIds = new Set<string>();
    for (const line of lines) {
      if (line.kind === 'service') {
        presentServiceIds.add(line.service.id);
      } else if (line.kind === 'combo') {
        for (const c of line.components) {
          if ('service' in c) presentServiceIds.add(c.service.id);
        }
      }
    }

    const out: ResolvedAutoIncludeDep[] = [];
    const seenDepIds = new Set<string>();
    for (const line of lines) {
      if (line.kind === 'service') {
        await this.collectAutoIncludeDeps(
          em,
          tenantId,
          line.service.id,
          line.slotStart,
          line.slotEnd,
          line.assignedStaffId,
          presentServiceIds,
          seenDepIds,
          out,
        );
      } else if (line.kind === 'combo') {
        for (const c of line.components) {
          if ('service' in c) {
            await this.collectAutoIncludeDeps(
              em,
              tenantId,
              c.service.id,
              c.slotStart,
              c.slotEnd,
              c.assignedStaffId,
              presentServiceIds,
              seenDepIds,
              out,
            );
          }
        }
      }
    }
    return out;
  }

  // Batch-loads `full_name` for every staff id referenced by the lines + deps
  // so the quote response can carry `assigned_staff_name` on each line in a
  // single query. The map's absence on a key means "no name found" — render
  // falls back to "Qualquer Disponível" on the FE.
  private async loadStaffNamesForQuote(
    tenantId: string,
    lines: ResolvedLine[],
    deps: ResolvedAutoIncludeDep[],
  ): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const line of lines) {
      if (line.kind === 'service' && line.assignedStaffId) {
        ids.add(line.assignedStaffId);
      } else if (line.kind === 'combo') {
        for (const c of line.components) {
          if ('service' in c && c.assignedStaffId) ids.add(c.assignedStaffId);
        }
      }
    }
    for (const dep of deps) {
      if (dep.assignedStaffId) ids.add(dep.assignedStaffId);
    }
    if (ids.size === 0) return new Map();
    const users = await this.em.find(
      User,
      { id: { $in: [...ids] }, tenant_id: tenantId },
      noTenantFilter(),
    );
    const map = new Map<string, string>();
    for (const u of users) {
      if (u.full_name) map.set(u.id, u.full_name);
    }
    return map;
  }

  private async collectAutoIncludeDeps(
    em: EntityManager,
    tenantId: string,
    serviceId: string,
    slotStart: Date,
    slotEnd: Date,
    assignedStaffId: string | undefined,
    presentServiceIds: Set<string>,
    seenDepIds: Set<string>,
    out: ResolvedAutoIncludeDep[],
  ): Promise<void> {
    const deps = await em.find(
      ServiceDependency,
      { tenant_id: tenantId, service: serviceId, auto_include: true },
      { populate: ['depends_on_service'], ...noTenantFilter() },
    );
    for (const dep of deps) {
      const depId = dep.depends_on_service.id;
      if (presentServiceIds.has(depId) || seenDepIds.has(depId)) continue;
      seenDepIds.add(depId);
      out.push({
        dependencyService: dep.depends_on_service,
        slotStart,
        slotEnd,
        assignedStaffId,
      });
    }
  }

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

  private persistLine(
    em: EntityManager,
    tenantId: string,
    order: SaleOrder,
    line: ResolvedLine,
  ): void {
    const item = new SaleOrderItem();
    item.tenant_id = tenantId;
    item.sale_order = order;
    item.is_dependency = false;

    if (line.kind === 'service') {
      item.catalog_item_type = SaleOrderItemType.SERVICE;
      item.catalog_item_id = line.service.id;
      item.service = line.service;
      item.name_snapshot = line.service.name;
      item.quantity = 1;
      item.price = line.unitPrice.toFixed(2);
      item.slot_start_at = line.slotStart;
      item.slot_end_at = line.slotEnd;
      if (line.assignedStaffId) {
        const staff = em.getReference(User, line.assignedStaffId);
        item.assigned_staff = staff;
      }
      em.persist(item);
    } else if (line.kind === 'product') {
      item.catalog_item_type = SaleOrderItemType.PRODUCT;
      item.catalog_item_id = line.product.id;
      item.product = line.product;
      item.name_snapshot = line.product.name;
      item.quantity = line.quantity;
      item.price = line.unitPrice.toFixed(2);
      em.persist(item);
    } else {
      item.catalog_item_type = SaleOrderItemType.COMBO;
      item.catalog_item_id = line.combo.id;
      item.combo = line.combo;
      item.name_snapshot = line.combo.name;
      item.quantity = 1;
      item.price = line.unitPrice.toFixed(2);
      item.combo_components = line.snapshot;
      // Combo items expose their own slot window so the agenda can place the
      // block at the combo's actual start — not at the earliest dependency,
      // which may sit mid-combo (e.g. a wash that runs before the second
      // service). Derived from the service components since products inside
      // a combo have no time window.
      const serviceComponents = line.components.filter(
        (c): c is ResolvedComboServiceComponent => 'service' in c,
      );
      if (serviceComponents.length > 0) {
        item.slot_start_at = serviceComponents[0].slotStart;
        item.slot_end_at = serviceComponents[serviceComponents.length - 1].slotEnd;
      }
      em.persist(item);
    }
  }

  // Persists ONE pre-resolved auto-include dep as a SaleOrderItem with
  // price=0 and is_dependency=true. The dep list is built upstream by
  // `resolveAutoIncludeDepsForLines`, which de-dupes against the user's own
  // cart so we never write phantom rows for services the cart already covers.
  private persistAutoIncludeDep(
    em: EntityManager,
    tenantId: string,
    order: SaleOrder,
    dep: ResolvedAutoIncludeDep,
  ): void {
    const item = new SaleOrderItem();
    item.tenant_id = tenantId;
    item.sale_order = order;
    item.catalog_item_type = SaleOrderItemType.SERVICE;
    item.catalog_item_id = dep.dependencyService.id;
    item.service = dep.dependencyService;
    item.name_snapshot = dep.dependencyService.name;
    item.quantity = 1;
    item.price = '0.00';
    item.is_dependency = true;
    item.slot_start_at = dep.slotStart;
    item.slot_end_at = dep.slotEnd;
    if (dep.assignedStaffId) {
      item.assigned_staff = em.getReference(User, dep.assignedStaffId);
    }
    em.persist(item);
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
      items: this.toOrderItemsDto(o),
    };
  }

  private toOrderItemsDto(o: SaleOrder): SaleOrderItemDto[] {
    if (!o.items.isInitialized()) return [];
    return o.items
      .getItems()
      .filter((i) => !i.is_dependency)
      .map((i) => ({
        id: i.id,
        catalog_item_type: i.catalog_item_type,
        name: i.name_snapshot ?? '',
        quantity: i.quantity,
        assigned_staff_name: i.assigned_staff?.full_name,
        slot_start_at: i.slot_start_at?.toISOString(),
      }));
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

function sumLinesDuration(lines: ResolvedLine[]): number {
  let total = 0;
  for (const line of lines) {
    if (line.kind === 'service') total += line.durationMinutes;
    else if (line.kind === 'combo') total += line.totalDurationMinutes;
  }
  return total;
}

function toQuoteLine(line: ResolvedLine, staffNameById: Map<string, string>): BookingQuoteLineDto {
  if (line.kind === 'service') {
    return {
      catalog_item_type: 'service',
      catalog_item_id: line.service.id,
      name: line.service.name,
      quantity: 1,
      unit_price: line.unitPrice,
      line_total: line.unitPrice,
      duration_minutes: line.durationMinutes,
      is_dependency: false,
      assigned_staff_id: line.assignedStaffId,
      assigned_staff_name: line.assignedStaffId
        ? staffNameById.get(line.assignedStaffId)
        : undefined,
      slot_start_at: line.slotStart.toISOString(),
      slot_end_at: line.slotEnd.toISOString(),
    };
  }
  if (line.kind === 'product') {
    return {
      catalog_item_type: 'product',
      catalog_item_id: line.product.id,
      name: line.product.name,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      line_total: line.unitPrice * line.quantity,
      duration_minutes: 0,
      is_dependency: false,
    };
  }
  const serviceComponents = line.components.filter(
    (
      c,
    ): c is { service: Service } & {
      durationMinutes: number;
      basePrice: number;
      slotStart: Date;
      slotEnd: Date;
      assignedStaffId?: string;
    } => 'service' in c,
  );
  const slotStart = serviceComponents[0]?.slotStart;
  const slotEnd = serviceComponents[serviceComponents.length - 1]?.slotEnd;
  // All combo components share the cart line's `assigned_staff_id` (the user
  // picks staff once per combo), so the first component's staff is the
  // combo's staff for label purposes.
  const comboStaffId = serviceComponents[0]?.assignedStaffId;
  return {
    catalog_item_type: 'combo',
    catalog_item_id: line.combo.id,
    name: line.combo.name,
    quantity: 1,
    unit_price: line.unitPrice,
    line_total: line.unitPrice,
    duration_minutes: line.totalDurationMinutes,
    is_dependency: false,
    assigned_staff_id: comboStaffId,
    assigned_staff_name: comboStaffId ? staffNameById.get(comboStaffId) : undefined,
    slot_start_at: slotStart?.toISOString(),
    slot_end_at: slotEnd?.toISOString(),
  };
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

// Build the per-staff appointment DTO. Only the subset of items belonging to
// this staff contributes to `services` and to the time window. Items without
// a `slot_start_at` (legacy non-cart bookings) fall back to the order-level
// `scheduled_at`/`scheduled_end_at` so the column still positions the block.
function toAppointmentDtoForItems(order: SaleOrder, items: SaleOrderItem[]): AgendaAppointmentDto {
  // Per-(staff, order) headline list. Includes top-level SERVICE and COMBO
  // items — a multi-staff order with a combo on Bruno and a standalone
  // service on Ana yields "Corte + Lavagem" on Bruno's block and "Corte
  // Feminino" on Ana's. Dependency items (auto-included combo components)
  // are excluded so combos appear as their headline name, not as a list of
  // their constituents. Products are not staff-bound work and stay out of
  // this list.
  const serviceNames = items
    .filter(
      (i) =>
        (i.catalog_item_type === SaleOrderItemType.SERVICE ||
          i.catalog_item_type === SaleOrderItemType.COMBO) &&
        !i.is_dependency,
    )
    .map((i) => i.name_snapshot ?? i.service?.name ?? i.combo?.name)
    .filter((n): n is string => Boolean(n))
    .join(', ');

  // Per-column block window: the slot range of THIS staff column's items.
  // Used by the agenda grid for block positioning and sizing. Falls back to
  // the order-level scheduled times for legacy non-cart bookings that don't
  // set per-item slot fields.
  const slotStarts = items.map((i) => i.slot_start_at).filter((d): d is Date => Boolean(d));
  const slotEnds = items.map((i) => i.slot_end_at).filter((d): d is Date => Boolean(d));

  const blockStart =
    slotStarts.length > 0
      ? new Date(Math.min(...slotStarts.map((d) => d.getTime())))
      : order.scheduled_at!;
  const blockEnd =
    slotEnds.length > 0
      ? new Date(Math.max(...slotEnds.map((d) => d.getTime())))
      : (order.scheduled_end_at ?? null);
  const blockDurationMinutes = blockEnd
    ? Math.round((blockEnd.getTime() - blockStart.getTime()) / 60_000)
    : null;

  // Canonical order-level times: the customer-facing "this appointment is at
  // 09:00". Consistent with `/sale-orders` for the same order id. Used by the
  // detail sheet so every staff column shows the same start.
  const orderStart = order.scheduled_at!;
  const orderEnd = order.scheduled_end_at ?? null;
  const orderDurationMinutes = orderEnd
    ? Math.round((orderEnd.getTime() - orderStart.getTime()) / 60_000)
    : null;

  return {
    id: order.id,
    customer_name: order.customer.full_name ?? order.customer.phone ?? 'Cliente',
    customer_phone: order.customer.phone ?? null,
    customer_email: order.customer.email,
    services: serviceNames,
    scheduled_start_at: orderStart.toISOString(),
    scheduled_end_at: orderEnd?.toISOString() ?? null,
    duration_minutes: orderDurationMinutes,
    block_start_at: blockStart.toISOString(),
    block_end_at: blockEnd?.toISOString() ?? null,
    block_duration_minutes: blockDurationMinutes,
    state: order.state,
    total: Number(order.total_amount),
    booking_channel: order.booking_channel ?? null,
    created_at: order.created_at.toISOString(),
    notes: order.notes ?? null,
  };
}
