import { createHmac } from 'crypto';

import { EntityManager } from '@mikro-orm/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { Role } from '../src/tenancy/entities/role.entity';
import { TenantConfig } from '../src/tenancy/entities/tenant-config.entity';
import {
  Tenant,
  AccountType,
  SubscriptionType,
  TenantStatus,
} from '../src/tenancy/entities/tenant.entity';
import { UserRole } from '../src/tenancy/entities/user-role.entity';
import { User } from '../src/tenancy/entities/user.entity';

const PLAN_ID = 'plan-0000-0000-0000-000000000001';

function signUpPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'E2E Tenant',
    email: 'owner@e2e-tenant.com',
    password: 'Password1!',
    full_name: 'E2E Owner',
    account_type: AccountType.STANDARD,
    plan_id: PLAN_ID,
    subscription_type: SubscriptionType.FREE_TRIAL,
    ...overrides,
  };
}

describe('Sign-Up (e2e)', () => {
  let app: INestApplication<App>;
  let em: EntityManager;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    process.env['STRIPE_WEBHOOK_SECRET'] = 'test_stripe_webhook_secret_e2e';
    await app.init();

    em = moduleFixture.get<EntityManager>(EntityManager).fork();
  });

  afterAll(async () => {
    // Clean up all created test tenants
    for (const tid of createdTenantIds) {
      await em.nativeDelete(UserRole, { user: { tenant_id: tid } });
      await em.nativeDelete(User, { tenant_id: tid });
      await em.nativeDelete(Role, { tenant_id: tid });
      await em.nativeDelete(TenantConfig, { tenant_id: tid });
      await em.nativeDelete(Tenant, { id: tid });
    }
    await app.close();
  });

  // AC1: POST /sign-up creates tenant with TRIAL status
  it('POST /sign-up — 201 with trial status for free_trial subscription', async () => {
    const res = await request(app.getHttpServer())
      .post('/sign-up')
      .send(signUpPayload())
      .expect(201);

    const body = res.body as Record<string, unknown>;
    expect(body['tenant_id']).toEqual(expect.any(String));
    expect(body['status']).toBe(TenantStatus.TRIAL);
    expect(body['trial_ends_at']).toBeDefined();

    createdTenantIds.push(body['tenant_id'] as string);
  });

  // AC: default roles seeded in DB
  it('POST /sign-up — seeds 4 default system roles in DB', async () => {
    const res = await request(app.getHttpServer())
      .post('/sign-up')
      .send(signUpPayload({ name: 'Roles Test Tenant', email: 'owner@roles-test.com' }))
      .expect(201);

    const body = res.body as Record<string, unknown>;
    const tenantId = body['tenant_id'] as string;
    createdTenantIds.push(tenantId);

    em.clear();
    const roles = await em.find(Role, { tenant_id: tenantId }, { filters: false });
    expect(roles).toHaveLength(4);

    const names = roles.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['owner', 'ta', 'staff', 'customer']));
    expect(roles.every((r) => r.is_system)).toBe(true);
  });

  // AC: owner user created in DB
  it('POST /sign-up — creates owner user in DB', async () => {
    const res = await request(app.getHttpServer())
      .post('/sign-up')
      .send(signUpPayload({ name: 'User Test Tenant', email: 'owner@user-test.com' }))
      .expect(201);

    const body = res.body as Record<string, unknown>;
    const tenantId = body['tenant_id'] as string;
    createdTenantIds.push(tenantId);

    em.clear();
    const user = await em.findOne(User, { tenant_id: tenantId }, { filters: false });
    expect(user).not.toBeNull();
    expect(user!.email).toBe('owner@user-test.com');
  });

  // AC: user_roles entry created in DB
  it('POST /sign-up — creates user_role linking owner to owner role', async () => {
    const res = await request(app.getHttpServer())
      .post('/sign-up')
      .send(signUpPayload({ name: 'UR Test Tenant', email: 'owner@ur-test.com' }))
      .expect(201);

    const body = res.body as Record<string, unknown>;
    const tenantId = body['tenant_id'] as string;
    createdTenantIds.push(tenantId);

    em.clear();
    const user = await em.findOne(User, { tenant_id: tenantId }, { filters: false });
    expect(user).not.toBeNull();

    const userRole = await em.findOne(
      UserRole,
      { user: user!.id },
      { populate: ['role'], filters: false },
    );
    expect(userRole).not.toBeNull();
    expect(userRole!.role.name).toBe('owner');
  });

  // AC: unique name per parent validated
  it('POST /sign-up — 409 when tenant name already exists for same parent', async () => {
    const payload = signUpPayload({ name: 'Duplicate Corp', email: 'owner@dup1.com' });
    const first = await request(app.getHttpServer()).post('/sign-up').send(payload).expect(201);
    createdTenantIds.push((first.body as Record<string, unknown>)['tenant_id'] as string);

    await request(app.getHttpServer())
      .post('/sign-up')
      .send({ ...payload, email: 'owner@dup2.com' })
      .expect(409);
  });

  // AC: validation — missing required fields
  it('POST /sign-up — 400 for missing required fields', async () => {
    await request(app.getHttpServer()).post('/sign-up').send({}).expect(400);
  });

  // AC: validation — invalid account_type
  it('POST /sign-up — 400 for invalid account_type', async () => {
    await request(app.getHttpServer())
      .post('/sign-up')
      .send(signUpPayload({ account_type: 'invalid_type' }))
      .expect(400);
  });

  // AC: PA admin can create tenant manually (bypass payment) → active status
  it('POST /tenancy/create — 401 without auth token (route is protected)', async () => {
    await request(app.getHttpServer())
      .post('/tenancy/create')
      .send(signUpPayload({ name: 'Admin Corp', email: 'owner@admin-corp.com' }))
      .expect(401);
  });

  // AC: Stripe webhook — error path
  it('POST /webhooks/stripe — 400 with invalid signature', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('Stripe-Signature', 'invalid-sig')
      .send('{}')
      .expect(400);
  });

  // AC2: Stripe webhook creates tenant with active status (happy path)
  it('POST /webhooks/stripe — 200 with valid signature creates tenant with ACTIVE status', async () => {
    const secret = process.env['STRIPE_WEBHOOK_SECRET']!;
    const tenantId = '01960000-0001-7000-8001-000000000001';
    const ownerId = '01960000-0001-7000-8001-000000000002';

    const eventBody = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: {
            registration_pending: 'true',
            tenant_id: tenantId,
            owner_id: ownerId,
            name: 'Stripe Paid Corp',
            email: 'owner@stripe-paid-corp.com',
            password_hash: '',
            full_name: 'Stripe Owner',
            account_type: AccountType.STANDARD,
            plan_id: PLAN_ID,
          },
        },
      },
    });

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const hmac = createHmac('sha256', secret)
      .update(`${timestamp}.${eventBody}`, 'utf8')
      .digest('hex');
    const sigHeader = `t=${timestamp},v1=${hmac}`;

    await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', sigHeader)
      .send(eventBody)
      .expect(200);

    createdTenantIds.push(tenantId);

    em.clear();
    const tenant = await em.findOne(Tenant, { id: tenantId }, { filters: false });
    expect(tenant).not.toBeNull();
    expect(tenant!.status).toBe(TenantStatus.ACTIVE);
  });

  // AC6: PA admin happy-path — authenticated admin creates tenant with ACTIVE status
  it('POST /tenancy/create — 201 with ACTIVE status for authenticated user', async () => {
    const ownerEmail = 'owner@admin-happy-path.com';
    const ownerPassword = 'Password1!';

    const signUpRes = await request(app.getHttpServer())
      .post('/sign-up')
      .send(signUpPayload({ name: 'Admin Auth Base', email: ownerEmail }))
      .expect(201);

    createdTenantIds.push((signUpRes.body as Record<string, unknown>)['tenant_id'] as string);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ownerEmail, password: ownerPassword })
      .expect(200);

    const accessToken = (loginRes.body as Record<string, unknown>)['access_token'] as string;

    const adminRes = await request(app.getHttpServer())
      .post('/tenancy/create')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(
        signUpPayload({
          name: 'Admin Created Corp',
          email: 'owner@admin-created-corp.com',
          subscription_type: SubscriptionType.PAID,
        }),
      )
      .expect(201);

    const body = adminRes.body as Record<string, unknown>;
    expect(body['status']).toBe(TenantStatus.ACTIVE);
    createdTenantIds.push(body['tenant_id'] as string);
  });
});
