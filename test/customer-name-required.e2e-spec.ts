/**
 * Regression: a customer who logged in via phone must set a name before they
 * can perform any action on the API. The profile read/update endpoints stay
 * reachable so they can fix it; everything else is blocked (403) until then.
 * Enforced by ProfileCompleteGuard (global, runs after JwtAuthGuard).
 */
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
const SUFFIX = 'namereq';
const PHONE_RAW = '11987650002';
const PHONE_E164 = '+5511987650002';

describe('Customer name required (e2e)', () => {
  let app: INestApplication<App>;
  let em: EntityManager;
  let tenantId: string;
  let shopSlug: string;
  let ownerToken: string;
  let customerToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    em = moduleFixture.get<EntityManager>(EntityManager).fork();

    const signUpRes = await request(app.getHttpServer())
      .post('/sign-up')
      .send({
        name: `Name Req Tenant ${SUFFIX}`,
        email: `owner-${SUFFIX}@namereq.test`,
        password: 'Password1!',
        full_name: 'Name Req Owner',
        account_type: AccountType.STANDARD,
        plan_id: PLAN_ID,
        subscription_type: SubscriptionType.FREE_TRIAL,
      })
      .expect(201);
    tenantId = (signUpRes.body as Record<string, unknown>)['tenant_id'] as string;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `owner-${SUFFIX}@namereq.test`, password: 'Password1!' })
      .expect(200);
    ownerToken = (loginRes.body as { access_token: string }).access_token;

    shopSlug = `name-req-shop-${SUFFIX}`;
    const tenant = await em.findOne(Tenant, { id: tenantId }, { filters: false });
    if (!tenant) throw new Error('regression: tenant missing');
    tenant.slug = shopSlug;
    await em.flush();

    // Phone login → lazy-creates a nameless customer.
    await request(app.getHttpServer())
      .post('/auth/phone/start')
      .send({ tenant_slug: shopSlug, phone: PHONE_RAW })
      .expect(200);
    const linkRes = await request(app.getHttpServer())
      .get('/_test/last-magic-link')
      .query({ tenant_slug: shopSlug, phone: PHONE_E164 })
      .expect(200);
    const verifyRes = await request(app.getHttpServer())
      .post('/auth/phone/verify')
      .send({ token: (linkRes.body as { token: string }).token })
      .expect(200);
    customerToken = (verifyRes.body as { access_token: string }).access_token;
  });

  afterAll(async () => {
    em.setFilterParams('tenant', { tenantId: '00000000-0000-0000-0000-000000000000' });
    const conn = em.getConnection();
    const users = await em.find(User, { tenant_id: tenantId }, { filters: false });
    const userIds = users.map((u) => u.id);
    if (userIds.length > 0) {
      await em.nativeDelete(RefreshToken, { user: { $in: userIds } });
      await em.nativeDelete(UserRole, { user: { $in: userIds } });
    }
    await conn.execute('DELETE FROM magic_link_attempts WHERE tenant_id = ?', [tenantId]);
    await conn.execute('DELETE FROM magic_link_rate_limits WHERE tenant_id = ?', [tenantId]);
    await conn.execute('DELETE FROM users WHERE tenant_id = ?', [tenantId]);
    await conn.execute('DELETE FROM roles WHERE tenant_id = ?', [tenantId]);
    await conn.execute('DELETE FROM tenant_configs WHERE tenant_id = ?', [tenantId]);
    await em.nativeDelete(Tenant, { id: tenantId });
    await app.close();
  });

  it('blocks a nameless customer from a protected action with 403 profile_incomplete', async () => {
    const res = await request(app.getHttpServer())
      .get('/sale-orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
    expect((res.body as { code?: string }).code).toBe('profile_incomplete');
  });

  it('still lets a nameless customer read their own profile (whitelisted)', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect((res.body as { name: string | null }).name).toBeNull();
  });

  it('does not gate staff/owner users (they always have a name)', async () => {
    await request(app.getHttpServer())
      .get('/sale-orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
  });

  it('lets a nameless customer set their name then unblocks every action', async () => {
    // Whitelisted: the customer can update their own profile to add a name.
    await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ full_name: 'Maria Souza' })
      .expect(200);

    // The previously-blocked action now succeeds with the same token.
    await request(app.getHttpServer())
      .get('/sale-orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
  });
});
