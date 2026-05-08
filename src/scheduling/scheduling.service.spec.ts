import { Service, ServiceStatus } from '@catalog/entities/service.entity';
import { ACTIVE_BOOKING_STATES } from '@commerce/entities/sale-order.entity';
import { EntityManager } from '@mikro-orm/core';
import { Test, TestingModule } from '@nestjs/testing';
import { User, UserState } from '@tenancy/entities/user.entity';

import { SchedulingService } from './scheduling.service';

function makeService(): Service {
  const svc = new Service();
  svc.id = 'svc-1';
  svc.tenant_id = 't-1';
  svc.name = 'Corte';
  svc.duration_minutes = 30;
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
