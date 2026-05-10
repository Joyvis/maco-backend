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
import { SaleOrder, SaleOrderState } from '../src/commerce/entities/sale-order.entity';
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
      full_name: 'Cart E2E Owner',
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
  customerId: string;
  shopSlug: string;
  serviceA: { id: string; name: string; durationMinutes: number; basePrice: number };
  serviceB: { id: string; name: string; durationMinutes: number; basePrice: number };
  product: { id: string; basePrice: number };
  comboId: string;
  staffA: { id: string };
  staffB: { id: string };
}

describe('Booking cart (e2e)', () => {
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
      await conn.execute('DELETE FROM combo_items WHERE tenant_id = ?', [tid]);
      await conn.execute('DELETE FROM combos WHERE tenant_id = ?', [tid]);
      await conn.execute('DELETE FROM service_dependencies WHERE tenant_id = ?', [tid]);
      await conn.execute('DELETE FROM service_consumptions WHERE tenant_id = ?', [tid]);
      await conn.execute('DELETE FROM services WHERE tenant_id = ?', [tid]);
      await conn.execute('DELETE FROM products WHERE tenant_id = ?', [tid]);
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

  async function seedShop(slugSuffix: string): Promise<SeededShop> {
    const owner = await signUpAndLogin(
      app,
      `Cart Tenant ${slugSuffix}`,
      `owner-${slugSuffix}@cart.test`,
    );
    createdTenantIds.push(owner.tenantId);

    const tenant = await em.findOne(Tenant, { id: owner.tenantId }, { filters: false });
    if (!tenant) throw new Error('seed: tenant missing');
    const slug = `cart-shop-${slugSuffix}`;
    tenant.slug = slug;
    tenant.address_line1 = '123 Main St';
    tenant.city = 'São Paulo';
    tenant.state = 'SP';
    tenant.postal_code = '01000-000';
    tenant.latitude = '-23.550000';
    tenant.longitude = '-46.633000';
    await em.flush();

    const svcAResp = await request(app.getHttpServer())
      .post('/catalog/services')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: `Cut-${slugSuffix}`, duration_minutes: 30, base_price: 50 })
      .expect(201);
    const serviceAId = (svcAResp.body as { data: { id: string } }).data.id;
    await request(app.getHttpServer())
      .post(`/catalog/services/${serviceAId}/activate`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    const svcBResp = await request(app.getHttpServer())
      .post('/catalog/services')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: `Manicure-${slugSuffix}`, duration_minutes: 45, base_price: 40 })
      .expect(201);
    const serviceBId = (svcBResp.body as { data: { id: string } }).data.id;
    await request(app.getHttpServer())
      .post(`/catalog/services/${serviceBId}/activate`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    const prodResp = await request(app.getHttpServer())
      .post('/catalog/products')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: `Shampoo-${slugSuffix}`, unit: 'ml', base_price: 25 })
      .expect(201);
    const productId = (prodResp.body as { data: { id: string } }).data.id;
    await request(app.getHttpServer())
      .post(`/catalog/products/${productId}/activate`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    // Inactive product — must not appear in /shop response
    await request(app.getHttpServer())
      .post('/catalog/products')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: `DraftProd-${slugSuffix}`, unit: 'unit', base_price: 1 })
      .expect(201);

    const comboResp = await request(app.getHttpServer())
      .post('/catalog/combos')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: `Combo-${slugSuffix}`,
        discount_percentage: 10,
        items: [
          { item_type: 'service', item_id: serviceAId },
          { item_type: 'service', item_id: serviceBId },
        ],
      })
      .expect(201);
    const comboId = (comboResp.body as { data: { id: string } }).data.id;

    // Build two staff users with qualifications + schedules
    const staffRoleRow = await em.findOne(
      Role,
      { tenant_id: owner.tenantId, name: 'staff' },
      { filters: false },
    );
    if (!staffRoleRow) throw new Error('seed: staff role missing');
    const staffRole: Role = staffRoleRow;

    async function makeStaff(tag: string, qualifies: string[]): Promise<{ id: string }> {
      const id = randomUUID();
      const passwordHash = await bcrypt.hash('Password1!', 10);
      const user = em.create(User, {
        id,
        tenant_id: owner.tenantId,
        email: `${tag}-${slugSuffix}@staff.test`,
        password_hash: passwordHash,
        full_name: `Staff-${tag}-${slugSuffix}`,
        state: UserState.ACTIVE,
      });
      em.persist(user);
      em.persist(em.create(UserRole, { user, role: staffRole }));
      // Qualifications
      for (const sid of qualifies) {
        em.persist(
          em.create(StaffQualification, {
            tenant_id: owner.tenantId,
            user,
            service: em.getReference(Service, sid),
          }),
        );
      }
      // Schedule: every weekday 09:00–18:00
      for (let dow = 1; dow <= 5; dow += 1) {
        em.persist(
          em.create(StaffSchedule, {
            tenant_id: owner.tenantId,
            user,
            day_of_week: dow,
            start_time: '09:00:00',
            end_time: '18:00:00',
          }),
        );
      }
      await em.flush();
      return { id };
    }

    const staffA = await makeStaff('aaaaaaaaaaaa', [serviceAId]);
    const staffB = await makeStaff('bbbbbbbbbbbb', [serviceBId]);

    // Create a separate customer user for booking-as-customer flows
    const customer = await signUpAndLogin(
      app,
      `Cart Customer ${slugSuffix}`,
      `customer-${slugSuffix}@cart.test`,
    );
    createdTenantIds.push(customer.tenantId);
    // Cross-tenant customer is fine for testing — but we want the customer in the SHOP tenant.
    // Create a customer directly in the shop tenant via owner's POST /users.
    const userResp = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        email: `bookingcust-${slugSuffix}@cart.test`,
        full_name: 'Booking Customer',
        initial_roles: ['customer'],
      })
      .expect(201);
    const customerUserId = (userResp.body as { id: string }).id;

    // Reset the password directly so we can log in as the customer.
    const customerPasswordHash = await bcrypt.hash('Password1!', 10);
    await em.nativeUpdate(
      User,
      { id: customerUserId },
      { password_hash: customerPasswordHash },
      { filters: false },
    );

    const customerLoginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `bookingcust-${slugSuffix}@cart.test`, password: 'Password1!' })
      .expect(200);
    const customerLoginToken = (customerLoginRes.body as Record<string, unknown>)[
      'access_token'
    ] as string;

    return {
      tenantId: owner.tenantId,
      customerToken: customerLoginToken,
      customerId: customerUserId,
      shopSlug: slug,
      serviceA: { id: serviceAId, name: `Cut-${slugSuffix}`, durationMinutes: 30, basePrice: 50 },
      serviceB: {
        id: serviceBId,
        name: `Manicure-${slugSuffix}`,
        durationMinutes: 45,
        basePrice: 40,
      },
      product: { id: productId, basePrice: 25 },
      comboId,
      staffA,
      staffB,
    };
  }

  // ──────────────────────────────────────────────────────────
  // GET /shop/:slug
  // ──────────────────────────────────────────────────────────

  it('GET /shop/:slug returns combos, products, address, and filters out inactive items', async () => {
    const shop = await seedShop('shop1');

    const res = await request(app.getHttpServer()).get(`/shop/${shop.shopSlug}`).expect(200);

    const body = res.body as {
      slug: string;
      combos: Array<{
        id: string;
        discount_type: string;
        discount_value: number;
        subtotal: number;
        total: number;
        total_duration_minutes: number;
        items: Array<{ catalog_item_type: string; catalog_item_id: string; quantity: number }>;
      }>;
      products: Array<{ id: string; name: string; status?: string; unit: string }>;
      address?: { line1: string; state: string; postal_code: string; coordinates?: unknown };
      services: unknown[];
    };

    expect(body.slug).toBe(shop.shopSlug);
    expect(body.products).toHaveLength(1);
    expect(body.products[0].id).toBe(shop.product.id);
    expect(body.products[0].unit).toBe('ml');

    expect(body.combos).toHaveLength(1);
    const combo = body.combos[0];
    expect(combo.id).toBe(shop.comboId);
    expect(combo.discount_type).toBe('percentage');
    expect(combo.discount_value).toBe(10);
    expect(combo.subtotal).toBe(90);
    expect(combo.total).toBe(81);
    expect(combo.total_duration_minutes).toBe(75);
    expect(combo.items).toHaveLength(2);

    expect(body.address).toBeDefined();
    expect(body.address!.line1).toBe('123 Main St');
    expect(body.address!.state).toBe('SP');
    expect(body.address!.postal_code).toBe('01000-000');
    expect(body.address!.coordinates).toEqual({ lat: -23.55, lng: -46.633 });
  });

  // ──────────────────────────────────────────────────────────
  // POST /sale-orders — appointment with two services + two staff
  // ──────────────────────────────────────────────────────────

  it('POST /sale-orders creates a multi-service appointment with per-line staff', async () => {
    const shop = await seedShop('shop2');

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
            catalog_item_id: shop.serviceA.id,
            quantity: 1,
            assigned_staff_id: shop.staffA.id,
          },
          {
            catalog_item_type: 'service',
            catalog_item_id: shop.serviceB.id,
            quantity: 1,
            assigned_staff_id: shop.staffB.id,
          },
        ],
      })
      .expect(201);

    const orderId = (res.body as { data: { id: string } }).data.id;

    const items = await em.find(
      SaleOrderItem,
      { sale_order: orderId, tenant_id: shop.tenantId },
      { filters: false, populate: ['assigned_staff'] },
    );
    const persisted = items.filter((i) => !i.is_dependency);
    expect(persisted).toHaveLength(2);
    const lineA = persisted.find((i) => i.catalog_item_id === shop.serviceA.id)!;
    const lineB = persisted.find((i) => i.catalog_item_id === shop.serviceB.id)!;
    expect(lineA.assigned_staff?.id).toBe(shop.staffA.id);
    expect(lineB.assigned_staff?.id).toBe(shop.staffB.id);
    expect(lineA.slot_start_at!.getTime()).toBe(startAt.getTime());
    expect(lineB.slot_start_at!.getTime()).toBe(startAt.getTime() + 30 * 60_000);
  });

  it('POST /sale-orders rejects when staff is not qualified', async () => {
    const shop = await seedShop('shop3');
    const startAt = nextWeekdayAt(12);

    await request(app.getHttpServer())
      .post('/sale-orders')
      .set('Authorization', `Bearer ${shop.customerToken}`)
      .send({
        fulfillment: 'appointment',
        scheduled_start_at: startAt.toISOString(),
        items: [
          {
            catalog_item_type: 'service',
            catalog_item_id: shop.serviceA.id,
            quantity: 1,
            assigned_staff_id: shop.staffB.id, // staffB qualifies for B, not A
          },
        ],
      })
      .expect(422);
  });

  // ──────────────────────────────────────────────────────────
  // POST /sale-orders — combo with services
  // ──────────────────────────────────────────────────────────

  it('POST /sale-orders accepts a combo line and snapshots its discounted price + components', async () => {
    const shop = await seedShop('shop4');
    const startAt = nextWeekdayAt(13);

    const res = await request(app.getHttpServer())
      .post('/sale-orders')
      .set('Authorization', `Bearer ${shop.customerToken}`)
      .send({
        fulfillment: 'appointment',
        scheduled_start_at: startAt.toISOString(),
        items: [
          {
            catalog_item_type: 'combo',
            catalog_item_id: shop.comboId,
            quantity: 1,
          },
        ],
      })
      .expect(201);

    const orderId = (res.body as { data: { id: string } }).data.id;
    const items = await em.find(
      SaleOrderItem,
      { sale_order: orderId, tenant_id: shop.tenantId },
      { filters: false },
    );
    const comboItem = items.find((i) => i.catalog_item_type === SaleOrderItemType.COMBO);
    expect(comboItem).toBeDefined();
    expect(Number(comboItem!.price)).toBe(81);
    expect(comboItem!.combo_components).toHaveLength(2);
    expect(comboItem!.combo_components![0].catalog_item_type).toBe('service');
    expect(comboItem!.combo_components![1].slot_start_at).toBeDefined();
  });

  // ──────────────────────────────────────────────────────────
  // POST /sale-orders — pickup
  // ──────────────────────────────────────────────────────────

  it('POST /sale-orders accepts a pickup cart with products only', async () => {
    const shop = await seedShop('shop5');

    const res = await request(app.getHttpServer())
      .post('/sale-orders')
      .set('Authorization', `Bearer ${shop.customerToken}`)
      .send({
        fulfillment: 'pickup',
        items: [
          {
            catalog_item_type: 'product',
            catalog_item_id: shop.product.id,
            quantity: 2,
          },
        ],
      })
      .expect(201);

    const orderId = (res.body as { data: { id: string } }).data.id;
    const order = await em.findOne(
      SaleOrder,
      { id: orderId, tenant_id: shop.tenantId },
      { filters: false },
    );
    expect(order!.fulfillment).toBe('pickup');
    expect(order!.scheduled_at).toBeFalsy();
    expect(Number(order!.total_amount)).toBe(50);
  });

  it('POST /sale-orders rejects pickup containing a service', async () => {
    const shop = await seedShop('shop6');

    await request(app.getHttpServer())
      .post('/sale-orders')
      .set('Authorization', `Bearer ${shop.customerToken}`)
      .send({
        fulfillment: 'pickup',
        items: [
          {
            catalog_item_type: 'service',
            catalog_item_id: shop.serviceA.id,
            quantity: 1,
          },
        ],
      })
      .expect(400);
  });

  it('POST /sale-orders rejects appointment without any service or combo-with-service', async () => {
    const shop = await seedShop('shop7');
    const startAt = nextWeekdayAt(14);

    await request(app.getHttpServer())
      .post('/sale-orders')
      .set('Authorization', `Bearer ${shop.customerToken}`)
      .send({
        fulfillment: 'appointment',
        scheduled_start_at: startAt.toISOString(),
        items: [
          {
            catalog_item_type: 'product',
            catalog_item_id: shop.product.id,
            quantity: 1,
          },
        ],
      })
      .expect(400);
  });

  // ──────────────────────────────────────────────────────────
  // mark-picked-up
  // ──────────────────────────────────────────────────────────

  it('POST /sale-orders/:id/mark-picked-up transitions confirmed → completed for pickup', async () => {
    const shop = await seedShop('shop8');

    const res = await request(app.getHttpServer())
      .post('/sale-orders')
      .set('Authorization', `Bearer ${shop.customerToken}`)
      .send({
        fulfillment: 'pickup',
        items: [{ catalog_item_type: 'product', catalog_item_id: shop.product.id, quantity: 1 }],
      })
      .expect(201);
    const orderId = (res.body as { data: { id: string } }).data.id;

    // Pre-confirm: simulate payment success by flipping state directly
    await em.nativeUpdate(
      SaleOrder,
      { id: orderId },
      { state: SaleOrderState.CONFIRMED },
      { filters: false },
    );

    const pickRes = await request(app.getHttpServer())
      .post(`/sale-orders/${orderId}/mark-picked-up`)
      .set('Authorization', `Bearer ${shop.customerToken}`)
      .expect(200);

    const data = (pickRes.body as { data: { state: string; picked_up_at?: string } }).data;
    expect(data.state).toBe('completed');
    expect(data.picked_up_at).toEqual(expect.any(String));
  });

  it('POST /sale-orders/:id/mark-picked-up rejects appointment orders', async () => {
    const shop = await seedShop('shop9');
    const startAt = nextWeekdayAt(10);
    const res = await request(app.getHttpServer())
      .post('/sale-orders')
      .set('Authorization', `Bearer ${shop.customerToken}`)
      .send({
        fulfillment: 'appointment',
        scheduled_start_at: startAt.toISOString(),
        items: [
          {
            catalog_item_type: 'service',
            catalog_item_id: shop.serviceA.id,
            quantity: 1,
            assigned_staff_id: shop.staffA.id,
          },
        ],
      })
      .expect(201);
    const orderId = (res.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .post(`/sale-orders/${orderId}/mark-picked-up`)
      .set('Authorization', `Bearer ${shop.customerToken}`)
      .expect(400);
  });

  // ──────────────────────────────────────────────────────────
  // Backwards compat
  // ──────────────────────────────────────────────────────────

  it('POST /sale-orders accepts legacy single-service shape', async () => {
    const shop = await seedShop('shop10');
    const startAt = nextWeekdayAt(15);
    const date = startAt.toISOString().slice(0, 10);
    const startTime = startAt.toISOString().slice(11, 16);

    const res = await request(app.getHttpServer())
      .post('/sale-orders')
      .set('Authorization', `Bearer ${shop.customerToken}`)
      .send({
        service_id: shop.serviceA.id,
        shop_slug: shop.shopSlug,
        date,
        start_time: startTime,
        staff_id: shop.staffA.id,
      })
      .expect(201);

    expect((res.body as { data: { id: string } }).data.id).toEqual(expect.any(String));
  });

  // ──────────────────────────────────────────────────────────
  // Public availability + qualified-staff
  // ──────────────────────────────────────────────────────────

  it('GET /shop/:slug/services/:serviceId/availability with anchor+offset returns single slot', async () => {
    const shop = await seedShop('shop11');
    const anchor = nextWeekdayAt(10);

    const res = await request(app.getHttpServer())
      .get(`/shop/${shop.shopSlug}/services/${shop.serviceB.id}/availability`)
      .query({ anchor_at: anchor.toISOString(), offset_minutes: 30 })
      .expect(200);

    const body = res.body as {
      data: {
        mode: string;
        slot: { datetime: string; available: boolean; eligible_staff_ids: string[] };
      };
    };
    expect(body.data.mode).toBe('single');
    expect(body.data.slot.available).toBe(true);
    expect(body.data.slot.eligible_staff_ids).toContain(shop.staffB.id);
  });

  it('GET /shop/:slug/services/:serviceId/staff filters by slot_start_at', async () => {
    const shop = await seedShop('shop12');
    const startAt = nextWeekdayAt(11);

    const allRes = await request(app.getHttpServer())
      .get(`/shop/${shop.shopSlug}/services/${shop.serviceA.id}/staff`)
      .expect(200);
    const all = (allRes.body as { data: Array<{ user_id: string }> }).data;
    expect(all.find((s) => s.user_id === shop.staffA.id)).toBeDefined();

    const filteredRes = await request(app.getHttpServer())
      .get(`/shop/${shop.shopSlug}/services/${shop.serviceA.id}/staff`)
      .query({ slot_start_at: startAt.toISOString() })
      .expect(200);
    const filtered = (filteredRes.body as { data: Array<{ user_id: string }> }).data;
    expect(filtered.find((s) => s.user_id === shop.staffA.id)).toBeDefined();
  });
});

function nextWeekdayAt(hourUtc: number): Date {
  // Pick a day at least 7 days in the future to avoid overlapping with same-day fixtures.
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  const dow = d.getUTCDay();
  if (dow === 0) d.setUTCDate(d.getUTCDate() + 1);
  if (dow === 6) d.setUTCDate(d.getUTCDate() + 2);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d;
}
