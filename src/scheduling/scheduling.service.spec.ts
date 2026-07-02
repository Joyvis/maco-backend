import { Service, ServiceStatus } from '@catalog/entities/service.entity';
import { ACTIVE_BOOKING_STATES } from '@commerce/entities/sale-order.entity';
import { EntityManager } from '@mikro-orm/core';
import { Test, TestingModule } from '@nestjs/testing';
import { User, UserState } from '@tenancy/entities/user.entity';

import { SchedulingService } from './scheduling.service';

function makeService(durationMinutes = 30): Service {
  const svc = new Service();
  svc.id = 'svc-1';
  svc.tenant_id = 't-1';
  svc.name = 'Corte';
  svc.duration_minutes = durationMinutes;
  svc.base_price = '50.00';
  svc.status = ServiceStatus.ACTIVE;
  return svc;
}

function makeUser(id: string, name: string): User {
  const u = new User();
  u.id = id;
  u.tenant_id = 't-1';
  u.email = `${id}@x.test`;
  u.password_hash = 'x';
  u.full_name = name;
  u.state = UserState.ACTIVE;
  return u;
}

interface MockState {
  qualifiedUserIds: string[];
  schedules: Array<{ user_id: string; day_of_week: number; start_time: string; end_time: string }>;
  orders: Array<{ staff_id: string; scheduled_at: Date; scheduled_end_at: Date }>;
  users: User[];
  service: Service | null;
}

function buildEm(state: MockState): Partial<EntityManager> {
  return {
    findOne: ((entity: unknown) => {
      if (entity === Service) return Promise.resolve(state.service);
      return Promise.resolve(null);
    }) as EntityManager['findOne'],
    find: ((entity: unknown) => {
      if (entity === User) return Promise.resolve(state.users);
      return Promise.resolve([]);
    }) as EntityManager['find'],
    getConnection: () =>
      ({
        execute: (sql: string) => {
          if (sql.includes('staff_qualifications')) {
            return Promise.resolve(state.qualifiedUserIds.map((id) => ({ user_id: id })));
          }
          if (sql.includes('staff_schedules')) {
            return Promise.resolve(state.schedules);
          }
          if (sql.includes('sale_orders')) {
            return Promise.resolve(state.orders);
          }
          return Promise.resolve([]);
        },
      }) as unknown as ReturnType<EntityManager['getConnection']>,
  };
}

describe('SchedulingService.getQualifiedStaff', () => {
  // 2026-05-12 is a Tuesday (UTC day-of-week = 2).
  const TUESDAY_DOW = 2;
  const DATE = '2026-05-12';
  const START_TIME = '09:00';

  let module: TestingModule;
  let service: SchedulingService;

  async function bootstrap(state: MockState): Promise<void> {
    module = await Test.createTestingModule({
      providers: [SchedulingService, { provide: EntityManager, useValue: buildEm(state) }],
    }).compile();
    service = module.get(SchedulingService);
  }

  it('returns all qualified active staff when no filter is provided', async () => {
    const u1 = makeUser('u1', 'Maria');
    const u2 = makeUser('u2', 'João');
    await bootstrap({
      qualifiedUserIds: ['u1', 'u2'],
      users: [u1, u2],
      schedules: [],
      orders: [],
      service: makeService(),
    });

    const result = await service.getQualifiedStaff('t-1', 'svc-1');

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.user_id).sort()).toEqual(['u1', 'u2']);
  });

  it('excludes staff already booked at the requested slot', async () => {
    const u1 = makeUser('u1', 'Maria');
    const u2 = makeUser('u2', 'João');
    const slotStart = new Date(`${DATE}T${START_TIME}:00.000Z`);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);

    await bootstrap({
      qualifiedUserIds: ['u1', 'u2'],
      users: [u1, u2],
      schedules: [
        { user_id: 'u1', day_of_week: TUESDAY_DOW, start_time: '09:00', end_time: '18:00' },
        { user_id: 'u2', day_of_week: TUESDAY_DOW, start_time: '09:00', end_time: '18:00' },
      ],
      orders: [{ staff_id: 'u1', scheduled_at: slotStart, scheduled_end_at: slotEnd }],
      service: makeService(),
    });

    const result = await service.getQualifiedStaff('t-1', 'svc-1', {
      date: DATE,
      start_time: START_TIME,
    });

    expect(result.map((r) => r.user_id)).toEqual(['u2']);
    // Sanity: blocking states constant is referenced by the service.
    expect(ACTIVE_BOOKING_STATES.length).toBeGreaterThan(0);
  });

  it('excludes staff whose schedule does not cover the requested slot', async () => {
    const u1 = makeUser('u1', 'Maria');
    const u2 = makeUser('u2', 'João');

    await bootstrap({
      qualifiedUserIds: ['u1', 'u2'],
      users: [u1, u2],
      schedules: [
        // u1 starts at 10:00 — does not cover the 09:00 slot.
        { user_id: 'u1', day_of_week: TUESDAY_DOW, start_time: '10:00', end_time: '18:00' },
        { user_id: 'u2', day_of_week: TUESDAY_DOW, start_time: '09:00', end_time: '18:00' },
      ],
      orders: [],
      service: makeService(),
    });

    const result = await service.getQualifiedStaff('t-1', 'svc-1', {
      date: DATE,
      start_time: START_TIME,
    });

    expect(result.map((r) => r.user_id)).toEqual(['u2']);
  });
});

describe('SchedulingService.getAvailability — 15-min slot grid', () => {
  // Regression for the 30-min lockout: a 15-min booking at 09:00–09:15 used to
  // make the 09:15–09:30 gap unbookable because candidate starts were only
  // generated on :00/:30 boundaries. Slots must step by 15 min, and a start is
  // offered as available only when the SERVICE DURATION fits the gap.
  // 2026-07-03 is a Friday (UTC day-of-week = 5).
  const FRIDAY_DOW = 5;
  const DATE = '2026-07-03';

  let module: TestingModule;
  let service: SchedulingService;

  async function bootstrap(state: MockState): Promise<void> {
    module = await Test.createTestingModule({
      providers: [SchedulingService, { provide: EntityManager, useValue: buildEm(state) }],
    }).compile();
    service = module.get(SchedulingService);
  }

  // Staff u1 works 09:00–18:00 with two bookings — 09:00–09:15 and
  // 09:30–10:00 — leaving a free 09:15–09:30 gap.
  async function bookingSlots(durationMinutes: number) {
    await bootstrap({
      qualifiedUserIds: ['u1'],
      users: [makeUser('u1', 'Kauan')],
      service: makeService(durationMinutes),
      schedules: [
        { user_id: 'u1', day_of_week: FRIDAY_DOW, start_time: '09:00', end_time: '18:00' },
      ],
      orders: [
        {
          staff_id: 'u1',
          scheduled_at: new Date(`${DATE}T09:00:00.000Z`),
          scheduled_end_at: new Date(`${DATE}T09:15:00.000Z`),
        },
        {
          staff_id: 'u1',
          scheduled_at: new Date(`${DATE}T09:30:00.000Z`),
          scheduled_end_at: new Date(`${DATE}T10:00:00.000Z`),
        },
      ],
    });
    const result = await service.getAvailability('t-1', {
      service_id: 'svc-1',
      date: DATE,
      staff_id: 'u1',
    });
    if (result.shape !== 'booking') throw new Error('expected booking shape');
    return result.slots;
  }

  it('generates candidate starts every 15 minutes across the schedule block', async () => {
    const slots = await bookingSlots(15);
    const starts = slots.map((s) => s.start_time);
    expect(starts.slice(0, 4)).toEqual(['09:00', '09:15', '09:30', '09:45']);
    // 09:00–18:00 with 15-min duration → last start 17:45, one slot per 15 min.
    expect(starts[starts.length - 1]).toBe('17:45');
    expect(starts).toHaveLength(36);
  });

  it('offers the 09:15–09:30 gap as available for a 15-min service', async () => {
    const slots = await bookingSlots(15);
    const gap = slots.find((s) => s.start_time === '09:15');
    expect(gap).toEqual({
      date: DATE,
      start_time: '09:15',
      end_time: '09:30',
      available: true,
    });
    // The booked windows stay unavailable.
    expect(slots.find((s) => s.start_time === '09:00')?.available).toBe(false);
    expect(slots.find((s) => s.start_time === '09:30')?.available).toBe(false);
  });

  it('first available slot is 09:15, not 10:00', async () => {
    const slots = await bookingSlots(15);
    expect(slots.find((s) => s.available)?.start_time).toBe('09:15');
  });

  it('does NOT offer the 15-min gap to a 30-min service that cannot fit it', async () => {
    const slots = await bookingSlots(30);
    // 09:15 + 30 min = 09:45, overlapping the 09:30–10:00 booking.
    expect(slots.find((s) => s.start_time === '09:15')?.available).toBe(false);
    expect(slots.find((s) => s.available)?.start_time).toBe('10:00');
  });

  it('reschedule fallback grid also steps by 15 minutes', async () => {
    await bootstrap({
      qualifiedUserIds: [],
      users: [],
      service: null,
      schedules: [],
      orders: [],
    });
    // No service_id and no order_id → hardcoded 09:00–18:00 fallback grid.
    const result = await service.getAvailability('t-1', { date: DATE });
    if (result.shape !== 'reschedule') throw new Error('expected reschedule shape');
    const times = result.slots.map((s) => s.datetime.slice(11, 16));
    expect(times.slice(0, 3)).toEqual(['09:00', '09:15', '09:30']);
    expect(times).toContain('09:45');
  });
});
