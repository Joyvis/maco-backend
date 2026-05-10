import { randomUUID } from 'crypto';

import { EntityManager } from '@mikro-orm/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { Service } from '../src/catalog/entities/service.entity';
import { SaleOrder, SaleOrderState } from '../src/commerce/entities/sale-order.entity';
import { Payment, PaymentState } from '../src/payments/entities/payment.entity';
import { StaffSchedule } from '../src/scheduling/entities/staff-schedule.entity';
import { RefreshToken } from '../src/tenancy/entities/refresh-token.entity';
import { Role } from '../src/tenancy/entities/role.entity';
import { StaffQualification } from '../src/tenancy/entities/staff-qualification.entity';
import { AccountType, SubscriptionType, Tenant } from '../src/tenancy/entities/tenant.entity';
import { UserRole } from '../src/tenancy/entities/user-role.entity';
import { User, UserState } from '../src/tenancy/entities/user.entity';

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
      full_name: 'Pay E2E Owner',
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

interface SeededShop {
  tenantId: string;
  customerToken: string;
  serviceId: string;
  staffId: string;
}

describe('Payments (e2e)', () => {
  let app: INestApplication<App>;
  let em: EntityManager;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    process.env.PAYMENT_PROVIDER = 'mock';
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_URL = 'http://localhost:3000';
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
      await conn.execute('DELETE FROM payments WHERE tenant_id = ?', [tid]);
      await conn.execute('DELETE FROM sale_order_items WHERE tenant_id = ?', [tid]);
      await conn.execute('DELETE FROM sale_orders WHERE tenant_id = ?', [tid]);
      await conn.execute('DELETE FROM services WHERE tenant_id = ?', [tid]);
      await conn.execute('DELETE FROM categories WHERE tenant_id = ?', [tid]);
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

  async function seedShop(slugSuffix: string, servicePrice = 50): Promise<SeededShop> {
    const owner = await signUpAndLogin(
      app,
      `Pay Tenant ${slugSuffix}`,
      `pay-owner-${slugSuffix}@pay.test`,
    );
    createdTenantIds.push(owner.tenantId);

    const tenant = await em.findOne(Tenant, { id: owner.tenantId }, { filters: false });
    if (!tenant) throw new Error('seed: tenant missing');
    tenant.slug = `pay-shop-${slugSuffix}`;
    await em.flush();

    const svcRes = await request(app.getHttpServer())
      .post('/catalog/services')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: `Cut-${slugSuffix}`, duration_minutes: 30, base_price: servicePrice })
      .expect(201);
    const serviceId = (svcRes.body as { data: { id: string } }).data.id;
    await request(app.getHttpServer())
      .post(`/catalog/services/${serviceId}/activate`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    const staffRoleRow = await em.findOne(
      Role,
      { tenant_id: owner.tenantId, name: 'staff' },
      { filters: false },
    );
    if (!staffRoleRow) throw new Error('seed: staff role missing');
    const staffRole: Role = staffRoleRow;

    const staffId = randomUUID();
    const passwordHash = await bcrypt.hash('Password1!', 10);
    const staff = em.create(User, {
      id: staffId,
      tenant_id: owner.tenantId,
      email: `staff-${slugSuffix}@pay.test`,
      password_hash: passwordHash,
      full_name: `Staff-${slugSuffix}`,
      state: UserState.ACTIVE,
    });
    em.persist(staff);
    em.persist(em.create(UserRole, { user: staff, role: staffRole }));
    em.persist(
      em.create(StaffQualification, {
        tenant_id: owner.tenantId,
        user: staff,
        service: em.getReference(Service, serviceId),
      }),
    );
    for (let dow = 1; dow <= 5; dow += 1) {
      em.persist(
        em.create(StaffSchedule, {
          tenant_id: owner.tenantId,
          user: staff,
          day_of_week: dow,
          start_time: '09:00:00',
          end_time: '18:00:00',
        }),
      );
    }
    await em.flush();

    // Customer in the shop tenant
    const userResp = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        email: `pay-cust-${slugSuffix}@pay.test`,
        full_name: 'Pay Customer',
        initial_roles: ['customer'],
      })
      .expect(201);
    const customerUserId = (userResp.body as { id: string }).id;
    const customerHash = await bcrypt.hash('Password1!', 10);
    await em.nativeUpdate(
      User,
      { id: customerUserId },
      { password_hash: customerHash },
      { filters: false },
    );

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `pay-cust-${slugSuffix}@pay.test`, password: 'Password1!' })
      .expect(200);
    const customerToken = (loginRes.body as Record<string, unknown>)['access_token'] as string;

    return { tenantId: owner.tenantId, customerToken, serviceId, staffId };
  }

  function nextWeekdayAt(hourUtc: number): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7);
    const dow = d.getUTCDay();
    if (dow === 0) d.setUTCDate(d.getUTCDate() + 1);
    if (dow === 6) d.setUTCDate(d.getUTCDate() + 2);
    d.setUTCHours(hourUtc, 0, 0, 0);
    return d;
  }

  // ────────────────────────────────────────────────────────────────────────
  it('booking + mock-webhook(success) → SaleOrder is CONFIRMED, Payment.SUCCEEDED', async () => {
    const shop = await seedShop('s1');
    const startAt = nextWeekdayAt(9);

    const bookingRes = await request(app.getHttpServer())
      .post('/sale-orders')
      .set('Authorization', `Bearer ${shop.customerToken}`)
      .send({
        fulfillment: 'appointment',
        scheduled_start_at: startAt.toISOString(),
        items: [
          {
            catalog_item_type: 'service',
            catalog_item_id: shop.serviceId,
            quantity: 1,
            assigned_staff_id: shop.staffId,
          },
        ],
      })
      .expect(201);

    const orderId = (bookingRes.body as { data: { id: string; payment_url: string } }).data.id;
    const paymentUrl = (bookingRes.body as { data: { payment_url: string } }).data.payment_url;
    expect(paymentUrl).toMatch(
      new RegExp(`^http://localhost:3000/booking/${orderId}/checkout\\?session=[0-9a-f-]{36}$`),
    );
    const sessionId = new URL(paymentUrl).searchParams.get('session') as string;

    const okRes = await request(app.getHttpServer())
      .post('/payments/webhook/mock')
      .send({ session_id: sessionId, outcome: 'success' })
      .expect(200);
    expect((okRes.body as { status: string }).status).toBe('accepted');

    em.clear();
    const order = await em.findOne(
      SaleOrder,
      { id: orderId, tenant_id: shop.tenantId },
      { filters: false },
    );
    expect(order!.state).toBe(SaleOrderState.CONFIRMED);

    const payment = await em.findOne(
      Payment,
      { sale_order: orderId, tenant_id: shop.tenantId },
      { filters: false },
    );
    expect(payment!.state).toBe(PaymentState.SUCCEEDED);

    // Idempotent replay returns 200/replay
    const replayRes = await request(app.getHttpServer())
      .post('/payments/webhook/mock')
      .send({ session_id: sessionId, outcome: 'success' })
      .expect(200);
    expect((replayRes.body as { status: string }).status).toBe('replay');
  });

  it('booking + mock-webhook(failure) → SaleOrder CANCELLED, slot freed', async () => {
    const shop = await seedShop('s2');
    const startAt = nextWeekdayAt(10);

    const book = async (): Promise<{ id: string; sessionId: string }> => {
      const res = await request(app.getHttpServer())
        .post('/sale-orders')
        .set('Authorization', `Bearer ${shop.customerToken}`)
        .send({
          fulfillment: 'appointment',
          scheduled_start_at: startAt.toISOString(),
          items: [
            {
              catalog_item_type: 'service',
              catalog_item_id: shop.serviceId,
              quantity: 1,
              assigned_staff_id: shop.staffId,
            },
          ],
        })
        .expect(201);
      const data = (res.body as { data: { id: string; payment_url: string } }).data;
      return {
        id: data.id,
        sessionId: new URL(data.payment_url).searchParams.get('session') as string,
      };
    };

    const first = await book();

    await request(app.getHttpServer())
      .post('/payments/webhook/mock')
      .send({ session_id: first.sessionId, outcome: 'failure' })
      .expect(200);

    em.clear();
    const cancelled = await em.findOne(
      SaleOrder,
      { id: first.id, tenant_id: shop.tenantId },
      { filters: false },
    );
    expect(cancelled!.state).toBe(SaleOrderState.CANCELLED);

    // Same slot must now be re-bookable.
    const second = await book();
    expect(second.id).not.toBe(first.id);
  });

  it('booking with magic amount R$ 0.34 → Payment.metadata.simulated_outcome=auto_fail', async () => {
    const shop = await seedShop('s3', 0.34);
    const startAt = nextWeekdayAt(11);

    const res = await request(app.getHttpServer())
      .post('/sale-orders')
      .set('Authorization', `Bearer ${shop.customerToken}`)
      .send({
        fulfillment: 'appointment',
        scheduled_start_at: startAt.toISOString(),
        items: [
          {
            catalog_item_type: 'service',
            catalog_item_id: shop.serviceId,
            quantity: 1,
            assigned_staff_id: shop.staffId,
          },
        ],
      })
      .expect(201);
    const orderId = (res.body as { data: { id: string } }).data.id;

    const paymentsRes = await request(app.getHttpServer())
      .get(`/sale-orders/${orderId}/payments`)
      .set('Authorization', `Bearer ${shop.customerToken}`)
      .expect(200);

    const payments = (
      paymentsRes.body as {
        data: Array<{ provider_metadata: Record<string, unknown> }>;
      }
    ).data;
    expect(payments).toHaveLength(1);
    expect(payments[0].provider_metadata.simulated_outcome).toBe('auto_fail');
  });

  it('unknown webhook session returns 404', async () => {
    await request(app.getHttpServer())
      .post('/payments/webhook/mock')
      .send({ session_id: randomUUID(), outcome: 'success' })
      .expect(404);
  });

  it('expiration: pending payment past expires_at → cron transitions to CANCELLED', async () => {
    const shop = await seedShop('s4');
    const startAt = nextWeekdayAt(12);

    const res = await request(app.getHttpServer())
      .post('/sale-orders')
      .set('Authorization', `Bearer ${shop.customerToken}`)
      .send({
        fulfillment: 'appointment',
        scheduled_start_at: startAt.toISOString(),
        items: [
          {
            catalog_item_type: 'service',
            catalog_item_id: shop.serviceId,
            quantity: 1,
            assigned_staff_id: shop.staffId,
          },
        ],
      })
      .expect(201);
    const orderId = (res.body as { data: { id: string } }).data.id;

    // Fast-forward this single payment by setting expires_at into the past.
    const conn = em.getConnection();
    await conn.execute(`update payments set expires_at = ? where sale_order_id = ?`, [
      new Date('2000-01-01T00:00:00Z'),
      orderId,
    ]);

    const cronRes = await request(app.getHttpServer())
      .post('/payments/_test/run-expiration')
      .send({})
      .expect(200);
    expect((cronRes.body as { expired: number }).expired).toBeGreaterThanOrEqual(1);

    em.clear();
    const order = await em.findOne(
      SaleOrder,
      { id: orderId, tenant_id: shop.tenantId },
      { filters: false },
    );
    expect(order!.state).toBe(SaleOrderState.CANCELLED);
    expect(order!.cancellation_reason).toBe('payment_expired');
  });

  it('GET /sale-orders/:id/payments returns the latest Payment row', async () => {
    const shop = await seedShop('s5', 50);
    const startAt = nextWeekdayAt(13);

    const res = await request(app.getHttpServer())
      .post('/sale-orders')
      .set('Authorization', `Bearer ${shop.customerToken}`)
      .send({
        fulfillment: 'appointment',
        scheduled_start_at: startAt.toISOString(),
        items: [
          {
            catalog_item_type: 'service',
            catalog_item_id: shop.serviceId,
            quantity: 1,
            assigned_staff_id: shop.staffId,
          },
        ],
      })
      .expect(201);
    const orderId = (res.body as { data: { id: string } }).data.id;

    const paymentsRes = await request(app.getHttpServer())
      .get(`/sale-orders/${orderId}/payments`)
      .set('Authorization', `Bearer ${shop.customerToken}`)
      .expect(200);
    const payments = (
      paymentsRes.body as {
        data: Array<{
          state: string;
          provider: string;
          amount: number;
          provider_metadata: Record<string, unknown>;
        }>;
      }
    ).data;
    expect(payments).toHaveLength(1);
    expect(payments[0].state).toBe('pending');
    expect(payments[0].provider).toBe('mock');
    expect(payments[0].amount).toBe(50);
    expect(payments[0].provider_metadata.simulated_outcome).toBeNull();
  });
});
