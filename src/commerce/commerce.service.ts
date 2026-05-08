import { ServiceDependency } from '@catalog/entities/service-dependency.entity';
import { Service } from '@catalog/entities/service.entity';
import { EntityManager } from '@mikro-orm/core';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { StaffQualification } from '@tenancy/entities/staff-qualification.entity';
import { Tenant } from '@tenancy/entities/tenant.entity';
import { User } from '@tenancy/entities/user.entity';

import { CancelOrderDto } from './dto/cancel-order.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { RescheduleOrderDto } from './dto/reschedule-order.dto';
import { BookingResultDto, RefundPolicyDto, SaleOrderResponseDto } from './dto/sale-order.dto';
import { RefundPolicy } from './entities/refund-policy.entity';
import { SaleOrderItem } from './entities/sale-order-item.entity';
import { ACTIVE_BOOKING_STATES, SaleOrder, SaleOrderState } from './entities/sale-order.entity';

const NO_TENANT_FILTER = { filters: { tenant: false } } as const;

@Injectable()
export class CommerceService {
  constructor(private readonly em: EntityManager) {}

  async createBooking(
    tenantId: string,
    customerId: string,
    dto: CreateBookingDto,
  ): Promise<BookingResultDto> {
    const tenant = await this.em.findOne(
      Tenant,
      { id: tenantId, slug: dto.shop_slug },
      { filters: false },
    );
    if (!tenant) throw new BadRequestException('shop_slug does not match tenant');

    const service = await this.em.findOne(
      Service,
      { id: dto.service_id, tenant_id: tenantId },
      NO_TENANT_FILTER,
    );
    if (!service) throw new NotFoundException('Service not found');

    const startAt = new Date(`${dto.date}T${dto.start_time}:00.000Z`);
    if (Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('Invalid date/time');
    }
    const endAt = new Date(startAt.getTime() + service.duration_minutes * 60_000);

    try {
      return await this.em.transactional(async (em) => {
        const staffId = await this.pickStaff(
          em,
          tenantId,
          service.id,
          dto.staff_id,
          startAt,
          endAt,
        );
        const customer = await em.findOne(
          User,
          { id: customerId, tenant_id: tenantId },
          NO_TENANT_FILTER,
        );
        if (!customer) throw new ForbiddenException('Customer not in tenant');
        const staff = await em.findOne(
          User,
          { id: staffId, tenant_id: tenantId },
          NO_TENANT_FILTER,
        );
        if (!staff) throw new UnprocessableEntityException('No staff available for this slot');

        const dependencies = await em.find(
          ServiceDependency,
          { tenant_id: tenantId, service: service.id, auto_include: true },
          { populate: ['depends_on_service'], ...NO_TENANT_FILTER },
        );

        const totalAmount = Number(service.base_price);
        const requiresPayment = totalAmount > 0;

        const order = new SaleOrder();
        order.tenant_id = tenantId;
        order.customer = customer;
        order.service = service;
        order.staff = staff;
        order.state = requiresPayment ? SaleOrderState.PENDING_PAYMENT : SaleOrderState.CONFIRMED;
        order.scheduled_at = startAt;
        order.scheduled_end_at = endAt;
        order.total_amount = totalAmount.toFixed(2);
        order.requires_payment = requiresPayment;
        if (requiresPayment) {
          order.payment_url = `/booking/pending/${order.id}`;
        }
        em.persist(order);

        const primaryItem = new SaleOrderItem();
        primaryItem.tenant_id = tenantId;
        primaryItem.sale_order = order;
        primaryItem.service = service;
        primaryItem.price = totalAmount.toFixed(2);
        primaryItem.is_dependency = false;
        em.persist(primaryItem);

        for (const dep of dependencies) {
          const item = new SaleOrderItem();
          item.tenant_id = tenantId;
          item.sale_order = order;
          item.service = dep.depends_on_service;
          item.price = '0.00';
          item.is_dependency = true;
          em.persist(item);
        }

        await em.flush();

        return {
          id: order.id,
          requires_payment: requiresPayment,
          payment_url: order.payment_url,
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
      orderBy: { scheduled_at: 'desc' },
      limit: page_size,
      offset: (page - 1) * page_size,
      populate: ['service', 'staff'],
      ...NO_TENANT_FILTER,
    });

    return {
      data: items.map((o) => this.toOrderDto(o)),
      meta: { total, page, page_size },
    };
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
      { populate: ['service', 'staff'], ...NO_TENANT_FILTER },
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
      { populate: ['service', 'staff'], ...NO_TENANT_FILTER },
    );
    if (!order) throw new NotFoundException('Order not found');
    if (order.customer.id !== customerId) {
      throw new ForbiddenException("Cannot reschedule another user's order");
    }
    if (!ACTIVE_BOOKING_STATES.includes(order.state)) {
      throw new BadRequestException('Order cannot be rescheduled in its current state');
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

  async listRefundPolicies(tenantId: string): Promise<RefundPolicyDto[]> {
    const policies = await this.em.find(
      RefundPolicy,
      { tenant_id: tenantId, is_active: true },
      { orderBy: { refund_percentage: 'desc' }, ...NO_TENANT_FILTER },
    );
    return policies.map((p) => ({
      id: p.id,
      description: p.description,
      refund_percentage: p.refund_percentage,
    }));
  }

  private async pickStaff(
    em: EntityManager,
    tenantId: string,
    serviceId: string,
    requestedStaffId: string | undefined,
    startAt: Date,
    endAt: Date,
  ): Promise<string> {
    let candidateIds: string[];
    if (requestedStaffId) {
      const qual = await em.findOne(
        StaffQualification,
        { tenant_id: tenantId, service: serviceId, user: requestedStaffId },
        NO_TENANT_FILTER,
      );
      if (!qual) {
        throw new UnprocessableEntityException('Staff is not qualified for this service');
      }
      candidateIds = [requestedStaffId];
    } else {
      const qualRows = (await em
        .getConnection()
        .execute(
          `select user_id from staff_qualifications where tenant_id = ? and service_id = ?`,
          [tenantId, serviceId],
        )) as Array<{ user_id: string }>;
      candidateIds = qualRows.map((r) => r.user_id);
      if (candidateIds.length === 0) {
        throw new UnprocessableEntityException('No qualified staff for this service');
      }
    }

    const placeholders = candidateIds.map(() => '?').join(',');
    const schedules = (await em
      .getConnection()
      .execute(
        `select user_id, day_of_week, start_time, end_time from staff_schedules where tenant_id = ? and user_id in (${placeholders})`,
        [tenantId, ...candidateIds],
      )) as Array<{
      user_id: string;
      day_of_week: number;
      start_time: string;
      end_time: string;
    }>;
    const busyRows = (await em
      .getConnection()
      .execute(
        `select staff_id from sale_orders where tenant_id = ? and staff_id in (${placeholders}) and state in (${ACTIVE_BOOKING_STATES.map(() => '?').join(',')}) and scheduled_at < ? and scheduled_end_at > ?`,
        [tenantId, ...candidateIds, ...ACTIVE_BOOKING_STATES, endAt, startAt],
      )) as Array<{ staff_id: string }>;
    const busyIds = new Set(busyRows.map((r) => r.staff_id));

    const dow = startAt.getUTCDay();
    const startM = startAt.getUTCHours() * 60 + startAt.getUTCMinutes();
    const endM = startM + Math.round((endAt.getTime() - startAt.getTime()) / 60_000);

    for (const sid of candidateIds) {
      const fits = schedules.some(
        (s) =>
          s.user_id === sid &&
          s.day_of_week === dow &&
          timeToMinutes(s.start_time) <= startM &&
          timeToMinutes(s.end_time) >= endM,
      );
      if (!fits) continue;
      if (!busyIds.has(sid)) return sid;
    }
    throw new UnprocessableEntityException('Slot is not available');
  }

  private toOrderDto(o: SaleOrder): SaleOrderResponseDto {
    return {
      id: o.id,
      state: o.state,
      scheduled_at: o.scheduled_at.toISOString(),
      service_name: o.service.name,
      professional_name: o.staff?.full_name,
      total_amount: Number(o.total_amount),
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
