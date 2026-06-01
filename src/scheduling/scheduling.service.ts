import { Service } from '@catalog/entities/service.entity';
import { ACTIVE_BOOKING_STATES, SaleOrder } from '@commerce/entities/sale-order.entity';
import { EntityManager } from '@mikro-orm/core';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Tenant } from '@tenancy/entities/tenant.entity';
import { User, UserState } from '@tenancy/entities/user.entity';

import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { AvailabilitySlot, QualifiedStaff, TimeSlot } from './dto/availability.dto';

const NO_TENANT_FILTER = { filters: { tenant: false } } as const;
const SLOT_GRID_MINUTES = 30;

interface ScheduleRow {
  user_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

interface OrderSlotRow {
  staff_id: string;
  scheduled_at: Date;
  scheduled_end_at: Date;
}

export interface PublicAvailabilityRangeSlot {
  date: string;
  start_time: string;
  end_time: string;
  available: boolean;
}

export interface PublicAvailabilitySingleSlot {
  datetime: string;
  available: boolean;
  eligible_staff_ids: string[];
}

@Injectable()
export class SchedulingService {
  constructor(private readonly em: EntityManager) {}

  async getQualifiedStaff(
    tenantId: string,
    serviceId: string,
    filter?: { date: string; start_time: string },
  ): Promise<QualifiedStaff[]> {
    const service = await this.em.findOne(
      Service,
      { id: serviceId, tenant_id: tenantId },
      NO_TENANT_FILTER,
    );
    if (!service) throw new NotFoundException('Service not found');

    const userIds = await this.qualifiedStaffIds(tenantId, serviceId);
    if (userIds.length === 0) return [];
    const users = await this.em.find(
      User,
      { id: { $in: userIds }, tenant_id: tenantId, state: UserState.ACTIVE },
      NO_TENANT_FILTER,
    );

    let availableUsers = users;
    if (filter) {
      const slotStart = new Date(`${filter.date}T${filter.start_time}:00.000Z`);
      const slotEnd = new Date(slotStart.getTime() + service.duration_minutes * 60_000);
      const rangeStart = new Date(`${filter.date}T00:00:00.000Z`);
      const rangeEnd = new Date(rangeStart);
      rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);

      const staffIds = users.map((u) => u.id);
      const schedules = await this.loadSchedules(tenantId, staffIds);
      const orders = await this.loadOrderSlots(tenantId, staffIds, rangeStart, rangeEnd);

      availableUsers = users.filter((u) =>
        isStaffAvailable(u.id, slotStart, slotEnd, schedules, orders),
      );
    }

    return availableUsers.map((u) => ({ user_id: u.id, name: u.full_name ?? '', email: u.email }));
  }

  async resolveTenantBySlug(slug: string): Promise<Tenant> {
    const tenant = await this.em.findOne(Tenant, { slug }, { filters: false });
    if (!tenant) throw new NotFoundException('Shop not found');
    return tenant;
  }

  async getPublicAvailabilityRange(
    tenantId: string,
    serviceId: string,
    dateFrom: string,
    dateTo?: string,
  ): Promise<PublicAvailabilityRangeSlot[]> {
    const slots = await this.computeBookingSlots(tenantId, {
      service_id: serviceId,
      date: dateFrom,
      end_date: dateTo,
    });
    return slots;
  }

  async getPublicAvailabilitySingleSlot(
    tenantId: string,
    serviceId: string,
    anchorAt: string,
    offsetMinutes: number,
  ): Promise<PublicAvailabilitySingleSlot> {
    const service = await this.em.findOne(
      Service,
      { id: serviceId, tenant_id: tenantId },
      NO_TENANT_FILTER,
    );
    if (!service) throw new NotFoundException('Service not found');

    const anchor = new Date(anchorAt);
    if (Number.isNaN(anchor.getTime())) {
      throw new BadRequestException('Invalid anchor_at');
    }
    if (!Number.isFinite(offsetMinutes) || offsetMinutes < 0) {
      throw new BadRequestException('offset_minutes must be >= 0');
    }
    const slotStart = new Date(anchor.getTime() + offsetMinutes * 60_000);
    const slotEnd = new Date(slotStart.getTime() + service.duration_minutes * 60_000);

    const userIds = await this.qualifiedStaffIds(tenantId, serviceId);
    if (userIds.length === 0) {
      return { datetime: slotStart.toISOString(), available: false, eligible_staff_ids: [] };
    }
    const users = await this.em.find(
      User,
      { id: { $in: userIds }, tenant_id: tenantId, state: UserState.ACTIVE },
      NO_TENANT_FILTER,
    );
    const staffIds = users.map((u) => u.id);
    const schedules = await this.loadSchedules(tenantId, staffIds);
    const dayStart = new Date(slotStart);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    const orders = await this.loadOrderSlots(tenantId, staffIds, dayStart, dayEnd);
    const eligible = staffIds.filter((sid) =>
      isStaffAvailable(sid, slotStart, slotEnd, schedules, orders),
    );
    return {
      datetime: slotStart.toISOString(),
      available: eligible.length > 0,
      eligible_staff_ids: eligible,
    };
  }

  async getPublicQualifiedStaff(
    tenantId: string,
    serviceId: string,
    slotStartAt?: string,
  ): Promise<QualifiedStaff[]> {
    if (!slotStartAt) return this.getQualifiedStaff(tenantId, serviceId);
    const slot = new Date(slotStartAt);
    if (Number.isNaN(slot.getTime())) {
      throw new BadRequestException('Invalid slot_start_at');
    }
    const date = formatDate(slot);
    const start_time = formatTime(slot);
    return this.getQualifiedStaff(tenantId, serviceId, { date, start_time });
  }

  private async qualifiedStaffIds(tenantId: string, serviceId: string): Promise<string[]> {
    const rows = (await this.em
      .getConnection()
      .execute(`select user_id from staff_qualifications where tenant_id = ? and service_id = ?`, [
        tenantId,
        serviceId,
      ])) as Array<{ user_id: string }>;
    return rows.map((r) => r.user_id);
  }

  // Returns every service the given staff member is qualified for, with the
  // service name populated by joining `services`. Mirror endpoint of
  // `getQualifiedStaff`; both read from the same `staff_qualifications` table.
  async getStaffQualifications(
    tenantId: string,
    userId: string,
  ): Promise<Array<{ service_id: string; service_name: string }>> {
    const rows = (await this.em
      .getConnection()
      .execute(
        `select sq.service_id, s.name as service_name
           from staff_qualifications sq
           join services s on s.id = sq.service_id
          where sq.tenant_id = ? and sq.user_id = ?
          order by s.name asc`,
        [tenantId, userId],
      )) as Array<{ service_id: string; service_name: string }>;
    return rows.map((r) => ({
      service_id: r.service_id,
      service_name: r.service_name,
    }));
  }

  async getAvailability(
    tenantId: string,
    query: AvailabilityQueryDto,
  ): Promise<
    { shape: 'booking'; slots: TimeSlot[] } | { shape: 'reschedule'; slots: AvailabilitySlot[] }
  > {
    if (query.service_id) {
      const slots = await this.computeBookingSlots(tenantId, query);
      return { shape: 'booking', slots };
    }
    const slots = await this.computeRescheduleSlots(tenantId, query);
    return { shape: 'reschedule', slots };
  }

  private async computeBookingSlots(
    tenantId: string,
    query: AvailabilityQueryDto,
  ): Promise<TimeSlot[]> {
    if (!query.service_id) {
      throw new BadRequestException('service_id is required');
    }

    const service = await this.em.findOne(
      Service,
      { id: query.service_id, tenant_id: tenantId },
      NO_TENANT_FILTER,
    );
    if (!service) throw new NotFoundException('Service not found');

    if (query.shop_slug) {
      const tenant = await this.em.findOne(
        Tenant,
        { id: tenantId, slug: query.shop_slug },
        { filters: false },
      );
      if (!tenant) throw new BadRequestException('shop_slug does not match tenant');
    }

    const startDate = parseDate(query.date);
    const endDate = query.end_date ? parseDate(query.end_date) : startDate;
    if (endDate < startDate) {
      throw new BadRequestException('end_date must be >= date');
    }

    const staffIds = await this.resolveStaffPool(tenantId, query.service_id, query.staff_id);
    if (staffIds.length === 0) return [];

    const schedules = await this.loadSchedules(tenantId, staffIds);
    const rangeStart = new Date(`${query.date}T00:00:00.000Z`);
    const rangeEnd = new Date(endDate);
    rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);
    const orders = await this.loadOrderSlots(tenantId, staffIds, rangeStart, rangeEnd);

    const slots: TimeSlot[] = [];
    const duration = service.duration_minutes;
    const days = enumerateDays(startDate, endDate);

    for (const day of days) {
      const dow = day.getUTCDay();
      const dayStr = formatDate(day);
      const candidates = generateSlotStarts(schedules, staffIds, dow, duration);

      for (const startMinutes of candidates) {
        const slotStart = utcAt(day, startMinutes);
        const slotEnd = new Date(slotStart.getTime() + duration * 60_000);
        const available = staffIds.some((sid) =>
          isStaffAvailable(sid, slotStart, slotEnd, schedules, orders),
        );
        slots.push({
          date: dayStr,
          start_time: formatTime(slotStart),
          end_time: formatTime(slotEnd),
          available,
        });
      }
    }

    return slots;
  }

  private async computeRescheduleSlots(
    tenantId: string,
    query: AvailabilityQueryDto,
  ): Promise<AvailabilitySlot[]> {
    if (!query.order_id) {
      const day = parseDate(query.date);
      const slots: AvailabilitySlot[] = [];
      for (let m = 9 * 60; m + SLOT_GRID_MINUTES <= 18 * 60; m += SLOT_GRID_MINUTES) {
        slots.push({ datetime: utcAt(day, m).toISOString(), available: true });
      }
      return slots;
    }

    const order = await this.em.findOne(
      SaleOrder,
      { id: query.order_id, tenant_id: tenantId },
      { populate: ['service', 'staff'], ...NO_TENANT_FILTER },
    );
    if (!order) throw new NotFoundException('Order not found');
    if (!order.service) throw new BadRequestException('Order has no primary service');

    const day = parseDate(query.date);
    const dow = day.getUTCDay();
    const duration = order.service.duration_minutes;
    const staffIds = order.staff
      ? [order.staff.id]
      : await this.resolveStaffPool(tenantId, order.service.id, undefined);
    if (staffIds.length === 0) return [];

    const schedules = await this.loadSchedules(tenantId, staffIds);
    const rangeStart = new Date(`${query.date}T00:00:00.000Z`);
    const rangeEnd = new Date(rangeStart);
    rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);
    const orders = await this.loadOrderSlots(tenantId, staffIds, rangeStart, rangeEnd, order.id);

    const candidates = generateSlotStarts(schedules, staffIds, dow, duration);
    const slots: AvailabilitySlot[] = [];
    for (const startMinutes of candidates) {
      const slotStart = utcAt(day, startMinutes);
      const slotEnd = new Date(slotStart.getTime() + duration * 60_000);
      const available = staffIds.some((sid) =>
        isStaffAvailable(sid, slotStart, slotEnd, schedules, orders),
      );
      slots.push({ datetime: slotStart.toISOString(), available });
    }
    return slots;
  }

  private async resolveStaffPool(
    tenantId: string,
    serviceId: string,
    staffId: string | undefined,
  ): Promise<string[]> {
    if (staffId) return [staffId];
    const userIds = await this.qualifiedStaffIds(tenantId, serviceId);
    if (userIds.length === 0) return [];
    const users = await this.em.find(
      User,
      { id: { $in: userIds }, tenant_id: tenantId, state: UserState.ACTIVE },
      NO_TENANT_FILTER,
    );
    return users.map((u) => u.id);
  }

  private async loadSchedules(tenantId: string, staffIds: string[]): Promise<ScheduleRow[]> {
    if (staffIds.length === 0) return [];
    const placeholders = staffIds.map(() => '?').join(',');
    return (await this.em
      .getConnection()
      .execute(
        `select user_id, day_of_week, start_time, end_time from staff_schedules where tenant_id = ? and user_id in (${placeholders})`,
        [tenantId, ...staffIds],
      )) as ScheduleRow[];
  }

  private async loadOrderSlots(
    tenantId: string,
    staffIds: string[],
    rangeStart: Date,
    rangeEnd: Date,
    excludeOrderId?: string,
  ): Promise<OrderSlotRow[]> {
    if (staffIds.length === 0) return [];
    const placeholders = staffIds.map(() => '?').join(',');
    const activeStates = ACTIVE_BOOKING_STATES.map(() => '?').join(',');
    const params: unknown[] = [
      tenantId,
      ...staffIds,
      ...ACTIVE_BOOKING_STATES,
      rangeStart,
      rangeEnd,
    ];
    let sql = `select staff_id, scheduled_at, scheduled_end_at from sale_orders where tenant_id = ? and staff_id in (${placeholders}) and state in (${activeStates}) and scheduled_at >= ? and scheduled_at < ?`;
    if (excludeOrderId) {
      sql += ` and id <> ?`;
      params.push(excludeOrderId);
    }
    const rows = (await this.em.getConnection().execute(sql, params)) as Array<{
      staff_id: string;
      scheduled_at: Date | string;
      scheduled_end_at: Date | string;
    }>;
    return rows.map((r) => ({
      staff_id: r.staff_id,
      scheduled_at: typeof r.scheduled_at === 'string' ? new Date(r.scheduled_at) : r.scheduled_at,
      scheduled_end_at:
        typeof r.scheduled_end_at === 'string' ? new Date(r.scheduled_end_at) : r.scheduled_end_at,
    }));
  }
}

function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTime(d: Date): string {
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function utcAt(day: Date, minutes: number): Date {
  const r = new Date(day);
  r.setUTCHours(0, 0, 0, 0);
  r.setUTCMinutes(minutes);
  return r;
}

function enumerateDays(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function timeStringToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function generateSlotStarts(
  schedules: ScheduleRow[],
  staffIds: string[],
  dow: number,
  duration: number,
): number[] {
  const set = new Set<number>();
  for (const sid of staffIds) {
    const blocks = schedules.filter((s) => s.user_id === sid && s.day_of_week === dow);
    for (const b of blocks) {
      const startM = timeStringToMinutes(b.start_time);
      const endM = timeStringToMinutes(b.end_time);
      for (let m = startM; m + duration <= endM; m += SLOT_GRID_MINUTES) {
        set.add(m);
      }
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

function isStaffAvailable(
  staffId: string,
  slotStart: Date,
  slotEnd: Date,
  schedules: ScheduleRow[],
  orders: OrderSlotRow[],
): boolean {
  const dow = slotStart.getUTCDay();
  const startM = slotStart.getUTCHours() * 60 + slotStart.getUTCMinutes();
  const endM = startM + Math.round((slotEnd.getTime() - slotStart.getTime()) / 60_000);

  const fitsSchedule = schedules.some(
    (s) =>
      s.user_id === staffId &&
      s.day_of_week === dow &&
      timeStringToMinutes(s.start_time) <= startM &&
      timeStringToMinutes(s.end_time) >= endM,
  );
  if (!fitsSchedule) return false;

  for (const o of orders) {
    if (o.staff_id !== staffId) continue;
    if (o.scheduled_at < slotEnd && o.scheduled_end_at > slotStart) {
      return false;
    }
  }
  return true;
}
