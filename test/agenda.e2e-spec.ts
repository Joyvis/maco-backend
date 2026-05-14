import { randomUUID } from 'crypto';

import { EntityManager } from '@mikro-orm/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { Service } from '../src/catalog/entities/service.entity';
import { SaleOrderItem, SaleOrderItemType } from '../src/commerce/entities/sale-order-item.entity';
import {
  SaleOrder,
  SaleOrderFulfillment,
  SaleOrderState,
} from '../src/commerce/entities/sale-order.entity';
import { StaffSchedule } from '../src/scheduling/entities/staff-schedule.entity';
import { RefreshToken } from '../src/tenancy/entities/refresh-token.entity';
import { Role } from '../src/tenancy/entities/role.entity';
import { StaffQualification } from '../src/tenancy/entities/staff-qualification.entity';
import { AccountType, SubscriptionType, Tenant } from '../src/tenancy/entities/tenant.entity';
import { UserRole } from '../src/tenancy/entities/user-role.entity';
import { User, UserState } from '../src/tenancy/entities/user.entity';

// 2026-04-16 is a Thursday (day_of_week = 4) in UTC
const AGENDA_DATE = '2026-04-16';
const PLAN_ID = '01960000-0000-7000-8000-000000000001';

async function signUpAndLogin(
  app: INestApplication<App>,
  tenantName: string,
  email: string,
): Promise<{ tenantId: string; accessToken: string; userId: string }> {
  const signUpRes = await request(app.getHttpServer())
    .post('/sign-up')
    .send({
      name: tenantName,
      email,
      password: 'Password1!',
      full_name: 'Agenda E2E Owner',
      account_type: AccountType.STANDARD,
      plan_id: PLAN_ID,
      subscription_type: SubscriptionType.FREE_TRIAL,
    })
    .expect(201);

  const tenantId = (signUpRes.body as Record<string, unknown>)['tenant_id'] as string;

  const loginRes = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: 'Password1!' })
    .expect(200);

  const body = loginRes.body as Record<string, unknown>;
  const accessToken = body['access_token'] as string;
  const userId = (body['user'] as { id: string } | undefined)?.id ?? '';
  return { tenantId, accessToken, userId };
}

describe('GET /sale-orders/agenda (e2e)', () => {
  let app: INestApplication<App>;
  let em: EntityManager;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    em = moduleFixture.get<EntityManager>(EntityManager).fork();
  });

  afterAll(async () => {
    em.setFilterParams('tenant', { tenantId: '00000000-0000-0000-0000-000000000000' });
    for (const tid of createdTenantIds) {
      const conn = em.getConnection();
      await conn.execute('DELETE FROM sale_order_items WHERE tenant_id = ?', [tid]);
      await conn.execute('DELETE FROM sale_orders WHERE tenant_id = ?', [tid]);
      await conn.execute('DELETE FROM services WHERE tenant_id = ?', [tid]);
      await conn.execute('DELETE FROM staff_qualifications WHERE tenant_id = ?', [tid]);
      await conn.execute('DELETE FROM staff_schedules WHERE tenant_id = ?', [tid]);
      const users = await em.find(User, { tenant_id: tid }, { filters: false });
      const userIds = users.map((u) => u.id);
      if (userIds.length > 0) {
        await em.nativeDelete(RefreshToken, { user: { $in: userIds } });
        await em.nativeDelete(UserRole, { user: { $in: userIds } });
      }
      await conn.execute('DELETE FROM users WHERE tenant_id = ?', [tid]);
      await conn.execute('DELETE FROM roles WHERE tenant_id = ?', [tid]);
      await conn.execute('DELETE FROM tenant_configs WHERE tenant_id = ?', [tid]);
      await em.nativeDelete(Tenant, { id: tid });
    }
    await app.close();
  });

  interface AgendaFixture {
    tenantId: string;
    ownerToken: string;
    ownerId: string;
    staffId: string;
    assignedOrderId: string;
    unassignedOrderId: string;
    cancelledOrderId: string;
  }

  async function seedAgendaFixture(suffix: string): Promise<AgendaFixture> {
    const owner = await signUpAndLogin(
      app,
      `Agenda Tenant ${suffix}`,
      `agenda-owner-${suffix}@test.com`,
    );
    createdTenantIds.push(owner.tenantId);

    const staffRoleRow = await em.findOne(
      Role,
      { tenant_id: owner.tenantId, name: 'staff' },
      { filters: false },
    );
    if (!staffRoleRow) throw new Error('seed: staff role missing');

    // Create staff user
    const staffId = randomUUID();
    const passwordHash = await bcrypt.hash('Password1!', 10);
    const staffUser = em.create(User, {
      id: staffId,
      tenant_id: owner.tenantId,
      email: `staff-${suffix}@test.com`,
      password_hash: passwordHash,
      full_name: `Staff-${suffix}`,
      state: UserState.ACTIVE,
    });
    em.persist(staffUser);
    em.persist(em.create(UserRole, { user: staffUser, role: staffRoleRow }));

    // Create a service for items
    const svcId = randomUUID();
    const service = em.create(Service, {
      id: svcId,
      tenant_id: owner.tenantId,
      name: `Haircut-${suffix}`,
      duration_minutes: 30,
      base_price: '50.00',
      status: 'active',
    } as never);
    em.persist(service);

    em.persist(
      em.create(StaffQualification, {
        tenant_id: owner.tenantId,
        user: staffUser,
        service,
      }),
    );

    // Schedule: Thursday (dow=4) 09:00–18:00
    em.persist(
      em.create(StaffSchedule, {
        tenant_id: owner.tenantId,
        user: staffUser,
        day_of_week: 4,
        start_time: '09:00:00',
        end_time: '18:00:00',
      }),
    );

    await em.flush();

    const ownerUser = await em.findOne(User, { id: owner.userId }, { filters: false });
    if (!ownerUser) throw new Error('seed: owner user missing');

    // Create an assigned (confirmed) order
    const assignedOrderId = randomUUID();
    const assignedOrder = em.create(SaleOrder, {
      id: assignedOrderId,
      tenant_id: owner.tenantId,
      customer: ownerUser,
      staff: staffUser,
      state: SaleOrderState.CONFIRMED,
      fulfillment: SaleOrderFulfillment.APPOINTMENT,
      total_amount: '50.00',
      requires_payment: false,
      scheduled_at: new Date('2026-04-16T10:00:00.000Z'),
      scheduled_end_at: new Date('2026-04-16T10:30:00.000Z'),
    } as never);
    em.persist(assignedOrder);

    const assignedItem = em.create(SaleOrderItem, {
      tenant_id: owner.tenantId,
      sale_order: assignedOrder,
      catalog_item_type: SaleOrderItemType.SERVICE,
      catalog_item_id: svcId,
      service,
      quantity: 1,
      price: '50.00',
      is_dependency: false,
      slot_start_at: new Date('2026-04-16T10:00:00.000Z'),
      slot_end_at: new Date('2026-04-16T10:30:00.000Z'),
    } as never);
    em.persist(assignedItem);

    // Create an unassigned (no staff) order
    const unassignedOrderId = randomUUID();
    const unassignedOrder = em.create(SaleOrder, {
      id: unassignedOrderId,
      tenant_id: owner.tenantId,
      customer: ownerUser,
      state: SaleOrderState.CONFIRMED,
      fulfillment: SaleOrderFulfillment.APPOINTMENT,
      total_amount: '50.00',
      requires_payment: false,
      scheduled_at: new Date('2026-04-16T11:00:00.000Z'),
      scheduled_end_at: new Date('2026-04-16T11:30:00.000Z'),
    } as never);
    em.persist(unassignedOrder);

    const unassignedItem = em.create(SaleOrderItem, {
      tenant_id: owner.tenantId,
      sale_order: unassignedOrder,
      catalog_item_type: SaleOrderItemType.SERVICE,
      catalog_item_id: svcId,
      service,
      quantity: 1,
      price: '50.00',
      is_dependency: false,
      slot_start_at: new Date('2026-04-16T11:00:00.000Z'),
      slot_end_at: new Date('2026-04-16T11:30:00.000Z'),
    } as never);
    em.persist(unassignedItem);

    // Create a cancelled order that must be excluded
    const cancelledOrderId = randomUUID();
    const cancelledOrder = em.create(SaleOrder, {
      id: cancelledOrderId,
      tenant_id: owner.tenantId,
      customer: ownerUser,
      staff: staffUser,
      state: SaleOrderState.CANCELLED,
      fulfillment: SaleOrderFulfillment.APPOINTMENT,
      total_amount: '50.00',
      requires_payment: false,
      scheduled_at: new Date('2026-04-16T12:00:00.000Z'),
      scheduled_end_at: new Date('2026-04-16T12:30:00.000Z'),
      cancellation_reason: 'test cancel',
      cancelled_at: new Date(),
    } as never);
    em.persist(cancelledOrder);

    await em.flush();

    return {
      tenantId: owner.tenantId,
      ownerToken: owner.accessToken,
      ownerId: owner.userId,
      staffId,
      assignedOrderId,
      unassignedOrderId,
      cancelledOrderId,
    };
  }

  it('returns 400 when date param is missing', async () => {
    const { accessToken } = await (async () => {
      const signUpRes = await request(app.getHttpServer())
        .post('/sign-up')
        .send({
          name: 'Agenda No Date Tenant',
          email: `agenda-nodate@test.com`,
          password: 'Password1!',
          full_name: 'Agenda No Date',
          account_type: AccountType.STANDARD,
          plan_id: PLAN_ID,
          subscription_type: SubscriptionType.FREE_TRIAL,
        })
        .expect(201);
      const tid = (signUpRes.body as Record<string, unknown>)['tenant_id'] as string;
      createdTenantIds.push(tid);
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `agenda-nodate@test.com`, password: 'Password1!' })
        .expect(200);
      return { accessToken: (loginRes.body as Record<string, unknown>)['access_token'] as string };
    })();

    await request(app.getHttpServer())
      .get('/sale-orders/agenda')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('returns 400 when date param is not a valid date string', async () => {
    const { ownerToken } = await seedAgendaFixture('invaldate');

    await request(app.getHttpServer())
      .get('/sale-orders/agenda?date=not-a-date')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
  });

  it('returns 401 when unauthenticated', async () => {
    await request(app.getHttpServer()).get(`/sale-orders/agenda?date=${AGENDA_DATE}`).expect(401);
  });

  it('returns correct staff + unassigned bucketing', async () => {
    const fixture = await seedAgendaFixture('bucket1');

    const res = await request(app.getHttpServer())
      .get(`/sale-orders/agenda?date=${AGENDA_DATE}`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);

    const body = res.body as { data: { staff: unknown[]; unassigned: unknown[] } };
    expect(body.data).toHaveProperty('staff');
    expect(body.data).toHaveProperty('unassigned');

    // Assigned order goes to staff entry
    expect(body.data.staff).toHaveLength(1);
    const staffEntry = body.data.staff[0] as {
      id: string;
      schedule_start: string;
      schedule_end: string;
      appointment_count: number;
      appointments: unknown[];
    };
    expect(staffEntry.id).toBe(fixture.staffId);
    expect(staffEntry.schedule_start).toBe('09:00');
    expect(staffEntry.schedule_end).toBe('18:00');
    expect(staffEntry.appointment_count).toBe(1);
    expect(staffEntry.appointments).toHaveLength(1);

    // Unassigned order goes to unassigned array
    expect(body.data.unassigned).toHaveLength(1);
    const unassigned = body.data.unassigned[0] as { id: string };
    expect(unassigned.id).toBe(fixture.unassignedOrderId);

    // Cancelled order must not appear anywhere
    const allIds = [
      ...(body.data.staff as Array<{ appointments: Array<{ id: string }> }>).flatMap(
        (s) => s.appointments,
      ),
      ...(body.data.unassigned as Array<{ id: string }>),
    ].map((a) => a.id);
    expect(allIds).not.toContain(fixture.cancelledOrderId);
  });

  it('appointment has all required fields', async () => {
    const fixture = await seedAgendaFixture('fields1');

    const res = await request(app.getHttpServer())
      .get(`/sale-orders/agenda?date=${AGENDA_DATE}`)
      .set('Authorization', `Bearer ${fixture.ownerToken}`)
      .expect(200);

    const body = res.body as {
      data: { staff: Array<{ appointments: Array<Record<string, unknown>> }> };
    };
    const appt = body.data.staff[0].appointments[0];

    expect(appt).toMatchObject({
      id: expect.any(String) as unknown,
      customer_name: expect.any(String) as unknown,
      customer_email: expect.any(String) as unknown,
      services: expect.any(String) as unknown,
      scheduled_start_at: expect.any(String) as unknown,
      state: SaleOrderState.CONFIRMED,
      total: expect.any(Number) as unknown,
    });
    expect(appt).toHaveProperty('customer_phone');
    expect(appt).toHaveProperty('scheduled_end_at');
    expect(appt).toHaveProperty('duration_minutes');
    expect(appt).toHaveProperty('booking_channel');
    expect(appt).toHaveProperty('created_at');
    expect(appt).toHaveProperty('notes');
  });

  it('empty response when no orders exist for date', async () => {
    const { accessToken } = await (async () => {
      const signUpRes = await request(app.getHttpServer())
        .post('/sign-up')
        .send({
          name: 'Agenda Empty Tenant',
          email: `agenda-empty@test.com`,
          password: 'Password1!',
          full_name: 'Agenda Empty',
          account_type: AccountType.STANDARD,
          plan_id: PLAN_ID,
          subscription_type: SubscriptionType.FREE_TRIAL,
        })
        .expect(201);
      const tid = (signUpRes.body as Record<string, unknown>)['tenant_id'] as string;
      createdTenantIds.push(tid);
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `agenda-empty@test.com`, password: 'Password1!' })
        .expect(200);
      return { accessToken: (loginRes.body as Record<string, unknown>)['access_token'] as string };
    })();

    const res = await request(app.getHttpServer())
      .get(`/sale-orders/agenda?date=${AGENDA_DATE}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const body = res.body as { data: { staff: unknown[]; unassigned: unknown[] } };
    expect(body.data.staff).toHaveLength(0);
    expect(body.data.unassigned).toHaveLength(0);
  });
});
