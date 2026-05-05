import { EntityManager } from '@mikro-orm/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { RefreshToken } from '../src/tenancy/entities/refresh-token.entity';
import { AccountType, SubscriptionType, Tenant } from '../src/tenancy/entities/tenant.entity';
import { UserRole } from '../src/tenancy/entities/user-role.entity';
import { User } from '../src/tenancy/entities/user.entity';

const PLAN_ID = '01960000-0000-7000-8000-000000000001';

async function signUpAndLogin(
  app: INestApplication<App>,
  tenantName: string,
  email: string,
): Promise<{ tenantId: string; accessToken: string }> {
  const signUpRes = await request(app.getHttpServer())
    .post('/sign-up')
    .send({
      name: tenantName,
      email,
      password: 'Password1!',
      full_name: 'E2E Owner',
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

  const accessToken = (loginRes.body as Record<string, unknown>)['access_token'] as string;
  return { tenantId, accessToken };
}

describe('Catalog (e2e)', () => {
  let app: INestApplication<App>;
  let em: EntityManager;
  const createdTenantIds: string[] = [];

  let tenantAToken: string;
  let tenantAId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    em = moduleFixture.get<EntityManager>(EntityManager).fork();

    const a = await signUpAndLogin(app, 'Catalog E2E Tenant A', 'owner@catalog-a.com');
    tenantAId = a.tenantId;
    tenantAToken = a.accessToken;
    createdTenantIds.push(tenantAId);
  });

  afterAll(async () => {
    em.setFilterParams('tenant', { tenantId: '00000000-0000-0000-0000-000000000000' });
    for (const tid of createdTenantIds) {
      const users = await em.find(User, { tenant_id: tid }, { filters: false });
      const userIds = users.map((u) => u.id);
      await em
        .getConnection()
        .execute('DELETE FROM service_dependencies WHERE tenant_id = ?', [tid]);
      await em
        .getConnection()
        .execute('DELETE FROM service_consumptions WHERE tenant_id = ?', [tid]);
      await em.getConnection().execute('DELETE FROM services WHERE tenant_id = ?', [tid]);
      await em.getConnection().execute('DELETE FROM products WHERE tenant_id = ?', [tid]);
      await em.getConnection().execute('DELETE FROM categories WHERE tenant_id = ?', [tid]);
      if (userIds.length > 0) {
        await em.nativeDelete(RefreshToken, { user: { $in: userIds } });
        await em.nativeDelete(UserRole, { user: { $in: userIds } });
      }
      await em.getConnection().execute('DELETE FROM users WHERE tenant_id = ?', [tid]);
      await em.getConnection().execute('DELETE FROM roles WHERE tenant_id = ?', [tid]);
      await em.getConnection().execute('DELETE FROM tenant_configs WHERE tenant_id = ?', [tid]);
      await em.nativeDelete(Tenant, { id: tid });
    }
    await app.close();
  });

  // Auth: 401 without token
  it('GET /catalog/products — 401 without JWT', async () => {
    await request(app.getHttpServer()).get('/catalog/products').expect(401);
  });

  // Create product → list returns it
  it('POST /catalog/products — create then list returns it', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/catalog/products')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Latte', unit: 'ml', base_price: 4.5 })
      .expect(201);

    const created = (createRes.body as { data: Record<string, unknown> }).data;
    expect(created['id']).toEqual(expect.any(String));
    expect(created['name']).toBe('Latte');
    expect(created['unit']).toBe('ml');
    expect(created['base_price']).toBe(4.5);
    expect(created['status']).toBe('draft');
    expect(created['created_at']).toEqual(expect.any(String));

    const listRes = await request(app.getHttpServer())
      .get('/catalog/products')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);

    const body = listRes.body as { data: unknown[]; meta: { total: number } };
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.meta.total).toBeGreaterThanOrEqual(1);
    expect(body.data.find((p) => (p as { id: string }).id === created['id'])).toBeDefined();
  });

  // Create category → assign on create → list returns category id
  it('POST /catalog/categories + create product with category', async () => {
    const catRes = await request(app.getHttpServer())
      .post('/catalog/categories')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Drinks' })
      .expect(201);

    const categoryId = (catRes.body as { data: { id: string } }).data.id;

    const prodRes = await request(app.getHttpServer())
      .post('/catalog/products')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Espresso', unit: 'ml', base_price: 3, category: categoryId })
      .expect(201);

    const product = (prodRes.body as { data: Record<string, unknown> }).data;
    expect(product['category']).toBe(categoryId);

    const listRes = await request(app.getHttpServer())
      .get('/catalog/products')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);

    const body = listRes.body as { data: Array<{ id: string; category?: string }> };
    const found = body.data.find((p) => p.id === product['id']);
    expect(found?.category).toBe(categoryId);
  });

  // Activate / archive transitions
  it('POST /catalog/products/:id/activate and /archive — status transitions', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/catalog/products')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Cappuccino', unit: 'ml', base_price: 5 })
      .expect(201);

    const id = (createRes.body as { data: { id: string } }).data.id;

    const activateRes = await request(app.getHttpServer())
      .post(`/catalog/products/${id}/activate`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);
    expect((activateRes.body as { data: { status: string } }).data.status).toBe('active');

    const archiveRes = await request(app.getHttpServer())
      .post(`/catalog/products/${id}/archive`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);
    expect((archiveRes.body as { data: { status: string } }).data.status).toBe('archived');
  });

  // PATCH product
  it('PATCH /catalog/products/:id — partial update', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/catalog/products')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Mocha', unit: 'ml', base_price: 4 })
      .expect(201);

    const id = (createRes.body as { data: { id: string } }).data.id;

    const patchRes = await request(app.getHttpServer())
      .patch(`/catalog/products/${id}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ base_price: 4.25, description: 'Chocolate coffee' })
      .expect(200);

    const data = (patchRes.body as { data: Record<string, unknown> }).data;
    expect(data['base_price']).toBe(4.25);
    expect(data['description']).toBe('Chocolate coffee');
    expect(data['name']).toBe('Mocha');
  });

  // GET single product 404 unknown
  it('GET /catalog/products/:id — 404 for unknown id', async () => {
    await request(app.getHttpServer())
      .get('/catalog/products/01960000-0000-7000-8000-00000000ffff')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(404);
  });

  // Cross-tenant isolation: tenant A's product not visible to tenant B → 404
  it('cross-tenant isolation: tenant B cannot see tenant A product', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/catalog/products')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'IsolationTest', unit: 'unit', base_price: 1 })
      .expect(201);
    const id = (createRes.body as { data: { id: string } }).data.id;

    const b = await signUpAndLogin(app, 'Catalog E2E Tenant B', 'owner@catalog-b.com');
    createdTenantIds.push(b.tenantId);

    await request(app.getHttpServer())
      .get(`/catalog/products/${id}`)
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(404);

    const listRes = await request(app.getHttpServer())
      .get('/catalog/products')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    const body = listRes.body as { data: Array<{ id: string }> };
    expect(body.data.find((p) => p.id === id)).toBeUndefined();
  });

  // Delete category referenced by a product → 409
  it('DELETE /catalog/categories/:id — 409 when referenced by a product', async () => {
    const catRes = await request(app.getHttpServer())
      .post('/catalog/categories')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Pastries' })
      .expect(201);
    const categoryId = (catRes.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .post('/catalog/products')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Croissant', unit: 'unit', base_price: 2.5, category: categoryId })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/catalog/categories/${categoryId}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(409);
  });

  // DELETE category with no references → 204
  it('DELETE /catalog/categories/:id — 204 when unreferenced', async () => {
    const catRes = await request(app.getHttpServer())
      .post('/catalog/categories')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Empty Category' })
      .expect(201);
    const categoryId = (catRes.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .delete(`/catalog/categories/${categoryId}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(204);
  });

  // Validation: missing name
  it('POST /catalog/products — 400 for missing name', async () => {
    await request(app.getHttpServer())
      .post('/catalog/products')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ unit: 'unit', base_price: 1 })
      .expect(400);
  });

  // Validation: negative base_price
  it('POST /catalog/products — 400 for negative base_price', async () => {
    await request(app.getHttpServer())
      .post('/catalog/products')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Bad', unit: 'unit', base_price: -1 })
      .expect(400);
  });

  // Validation: invalid unit
  it('POST /catalog/products — 400 for invalid unit', async () => {
    await request(app.getHttpServer())
      .post('/catalog/products')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Bad', unit: 'gallon', base_price: 1 })
      .expect(400);
  });

  // ──────────────────────────────────────────────────────
  // Services
  // ──────────────────────────────────────────────────────

  it('POST /catalog/services — create then list returns it on page 1', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/catalog/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Haircut', duration_minutes: 45, base_price: 29.9 })
      .expect(201);

    const created = (createRes.body as { data: Record<string, unknown> }).data;
    expect(created['id']).toEqual(expect.any(String));
    expect(created['name']).toBe('Haircut');
    expect(created['status']).toBe('draft');
    expect(created['duration_minutes']).toBe(45);
    expect(created['base_price']).toBe(29.9);
    expect(created['tenant_id']).toBe(tenantAId);

    const listRes = await request(app.getHttpServer())
      .get('/catalog/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);

    const body = listRes.body as {
      data: Array<{ id: string }>;
      meta: { total: number; page: number };
    };
    expect(body.meta.page).toBe(1);
    expect(body.data.find((s) => s.id === created['id'])).toBeDefined();
  });

  it('POST /catalog/services/:id/activate and /archive — idempotent transitions', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/catalog/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Manicure', duration_minutes: 30, base_price: 20 })
      .expect(201);
    const id = (createRes.body as { data: { id: string } }).data.id;

    const a1 = await request(app.getHttpServer())
      .post(`/catalog/services/${id}/activate`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);
    expect((a1.body as { data: { status: string } }).data.status).toBe('active');

    const a2 = await request(app.getHttpServer())
      .post(`/catalog/services/${id}/activate`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);
    expect((a2.body as { data: { status: string } }).data.status).toBe('active');

    const ar1 = await request(app.getHttpServer())
      .post(`/catalog/services/${id}/archive`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);
    expect((ar1.body as { data: { status: string } }).data.status).toBe('archived');

    const ar2 = await request(app.getHttpServer())
      .post(`/catalog/services/${id}/archive`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);
    expect((ar2.body as { data: { status: string } }).data.status).toBe('archived');
  });

  it('cross-tenant isolation: tenant B cannot read or modify tenant A service', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/catalog/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'IsolatedService', duration_minutes: 60, base_price: 50 })
      .expect(201);
    const id = (createRes.body as { data: { id: string } }).data.id;

    const b = await signUpAndLogin(app, 'Catalog Services Tenant B', 'owner@catalog-svc-b.com');
    createdTenantIds.push(b.tenantId);

    await request(app.getHttpServer())
      .get(`/catalog/services/${id}`)
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/catalog/services/${id}`)
      .set('Authorization', `Bearer ${b.accessToken}`)
      .send({ name: 'Hijack' })
      .expect(404);

    const listRes = await request(app.getHttpServer())
      .get('/catalog/services')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    const body = listRes.body as { data: Array<{ id: string }> };
    expect(body.data.find((s) => s.id === id)).toBeUndefined();
  });

  it('consumptions: add then remove a product consumption', async () => {
    const svcRes = await request(app.getHttpServer())
      .post('/catalog/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Color Treatment', duration_minutes: 90, base_price: 80 })
      .expect(201);
    const serviceId = (svcRes.body as { data: { id: string } }).data.id;

    const prodRes = await request(app.getHttpServer())
      .post('/catalog/products')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Hair Dye', unit: 'ml', base_price: 12 })
      .expect(201);
    const productId = (prodRes.body as { data: { id: string } }).data.id;

    const addRes = await request(app.getHttpServer())
      .post(`/catalog/services/${serviceId}/consumptions`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ product_id: productId, quantity: 50 })
      .expect(201);

    const consumption = (addRes.body as { data: Record<string, unknown> }).data;
    expect(consumption['service_id']).toBe(serviceId);
    expect(consumption['product_id']).toBe(productId);
    expect(consumption['quantity']).toBe(50);
    expect(consumption['unit']).toBe('ml');
    expect(consumption['product_name']).toBe('Hair Dye');

    const listRes = await request(app.getHttpServer())
      .get(`/catalog/services/${serviceId}/consumptions`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);
    expect((listRes.body as { data: unknown[] }).data).toHaveLength(1);

    await request(app.getHttpServer())
      .delete(`/catalog/services/${serviceId}/consumptions/${productId}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(204);

    const listAfter = await request(app.getHttpServer())
      .get(`/catalog/services/${serviceId}/consumptions`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);
    expect((listAfter.body as { data: unknown[] }).data).toHaveLength(0);
  });

  it('dependencies: add then remove a dependency, reject self-dependency', async () => {
    const aRes = await request(app.getHttpServer())
      .post('/catalog/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Wash', duration_minutes: 15, base_price: 10 })
      .expect(201);
    const aId = (aRes.body as { data: { id: string } }).data.id;

    const bRes = await request(app.getHttpServer())
      .post('/catalog/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Cut', duration_minutes: 30, base_price: 25 })
      .expect(201);
    const bId = (bRes.body as { data: { id: string } }).data.id;

    // self-dependency rejected
    await request(app.getHttpServer())
      .post(`/catalog/services/${aId}/dependencies`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ depends_on_service_id: aId })
      .expect(400);

    const addRes = await request(app.getHttpServer())
      .post(`/catalog/services/${bId}/dependencies`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ depends_on_service_id: aId })
      .expect(201);
    const dep = (addRes.body as { data: Record<string, unknown> }).data;
    expect(dep['service_id']).toBe(bId);
    expect(dep['depends_on_service_id']).toBe(aId);
    expect(dep['depends_on_service_name']).toBe('Wash');
    const dependencyId = dep['id'] as string;

    const listRes = await request(app.getHttpServer())
      .get(`/catalog/services/${bId}/dependencies`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);
    expect((listRes.body as { data: unknown[] }).data).toHaveLength(1);

    await request(app.getHttpServer())
      .delete(`/catalog/services/${bId}/dependencies/${dependencyId}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(204);
  });

  // List categories ordered by display_order then name
  it('GET /catalog/categories — ordered by display_order then name', async () => {
    const tid = await signUpAndLogin(app, 'Catalog Order Tenant', 'owner@catalog-order.com');
    createdTenantIds.push(tid.tenantId);

    const create = (name: string) =>
      request(app.getHttpServer())
        .post('/catalog/categories')
        .set('Authorization', `Bearer ${tid.accessToken}`)
        .send({ name })
        .expect(201);

    const aRes = await create('Beta');
    const bRes = await create('Alpha');
    const aId = (aRes.body as { data: { id: string } }).data.id;
    const bId = (bRes.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .patch(`/catalog/categories/${aId}`)
      .set('Authorization', `Bearer ${tid.accessToken}`)
      .send({ display_order: 1 })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/catalog/categories/${bId}`)
      .set('Authorization', `Bearer ${tid.accessToken}`)
      .send({ display_order: 2 })
      .expect(200);

    const listRes = await request(app.getHttpServer())
      .get('/catalog/categories')
      .set('Authorization', `Bearer ${tid.accessToken}`)
      .expect(200);

    const data = (listRes.body as { data: Array<{ id: string; display_order?: number }> }).data;
    expect(data[0].id).toBe(aId);
    expect(data[1].id).toBe(bId);
  });
});
