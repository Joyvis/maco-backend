import { EntityManager } from '@mikro-orm/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { UserRoleType } from '../src/tenancy/dto/create-user.dto';
import { Role } from '../src/tenancy/entities/role.entity';
import { TenantConfig } from '../src/tenancy/entities/tenant-config.entity';
import { AccountType, SubscriptionType, Tenant } from '../src/tenancy/entities/tenant.entity';
import { UserRole } from '../src/tenancy/entities/user-role.entity';
import { User } from '../src/tenancy/entities/user.entity';

const PLAN_ID = 'plan-0000-0000-0000-000000000001';

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

describe('Users (e2e)', () => {
  let app: INestApplication<App>;
  let em: EntityManager;
  const createdTenantIds: string[] = [];

  let ownerToken: string;
  let tenantId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    em = moduleFixture.get<EntityManager>(EntityManager).fork();

    const result = await signUpAndLogin(app, 'Users E2E Tenant', 'owner@users-e2e-test.com');
    tenantId = result.tenantId;
    ownerToken = result.accessToken;
    createdTenantIds.push(tenantId);
  });

  afterAll(async () => {
    for (const tid of createdTenantIds) {
      await em.nativeDelete(UserRole, { user: { tenant_id: tid } });
      await em.nativeDelete(User, { tenant_id: tid });
      await em.nativeDelete(Role, { tenant_id: tid });
      await em.nativeDelete(TenantConfig, { tenant_id: tid });
      await em.nativeDelete(Tenant, { id: tid });
    }
    await app.close();
  });

  // AC1 — happy path: create user with roles
  it('POST /users — 201 creates user with staff role', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        email: 'staff1@example.com',
        full_name: 'Staff Member',
        initial_roles: [UserRoleType.STAFF],
      })
      .expect(201);

    const body = res.body as Record<string, unknown>;
    expect(body['id']).toEqual(expect.any(String));
    expect(body['tenant_id']).toBe(tenantId);
    expect(body['email']).toBe('staff1@example.com');
    expect(body['full_name']).toBe('Staff Member');
    expect(body['state']).toBe('active');
    expect(body['roles']).toContain('staff');
    expect(body['phone']).toBeNull();
    expect(body['created_at']).toEqual(expect.any(String));
  });

  // AC1 — DB row verification
  it('POST /users — user and user_role rows exist in DB', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        email: 'dbcheck@example.com',
        full_name: 'DB Check User',
        initial_roles: [UserRoleType.STAFF],
      })
      .expect(201);

    const userId = (res.body as Record<string, unknown>)['id'] as string;

    em.clear();
    const user = await em.findOne(User, { id: userId }, { filters: false });
    expect(user).not.toBeNull();
    expect(user!.email).toBe('dbcheck@example.com');
    expect(user!.password_hash).toMatch(/^\$2b\$/);

    const userRole = await em.findOne(
      UserRole,
      { user: userId },
      { populate: ['role'], filters: false },
    );
    expect(userRole).not.toBeNull();
    expect(userRole!.role.name).toBe('staff');
  });

  // AC2 — happy path: create user without roles
  it('POST /users — 201 creates user without roles', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        email: 'noroles@example.com',
        full_name: 'No Roles User',
      })
      .expect(201);

    const body = res.body as Record<string, unknown>;
    expect(body['roles']).toEqual([]);

    em.clear();
    const userRole = await em.findOne(UserRole, { user: body['id'] as string }, { filters: false });
    expect(userRole).toBeNull();
  });

  // AC3 — duplicate email within same tenant → 409
  it('POST /users — 409 for duplicate email in same tenant', async () => {
    const payload = { email: 'dup@example.com', full_name: 'First User' };

    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(payload)
      .expect(201);

    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...payload, full_name: 'Duplicate User' })
      .expect(409);
  });

  // AC4 — same email allowed in different tenant
  it('POST /users — 201 allows same email in a different tenant', async () => {
    const sharedEmail = 'shared@example.com';

    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: sharedEmail, full_name: 'Tenant One User' })
      .expect(201);

    const { tenantId: tid2, accessToken: token2 } = await signUpAndLogin(
      app,
      'Users E2E Tenant Two',
      'owner@users-e2e-test2.com',
    );
    createdTenantIds.push(tid2);

    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${token2}`)
      .send({ email: sharedEmail, full_name: 'Tenant Two User' })
      .expect(201);
  });

  // AC6 — invalid input: missing email
  it('POST /users — 400 for missing email', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ full_name: 'No Email User' })
      .expect(400);
  });

  // AC6 — invalid input: empty full_name
  it('POST /users — 400 for empty full_name', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'valid@example.com', full_name: '' })
      .expect(400);
  });

  // AC6 — invalid email format
  it('POST /users — 400 for invalid email format', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'not-an-email', full_name: 'Valid Name' })
      .expect(400);
  });

  // AC7 — invalid role value
  it('POST /users — 400 for invalid initial_roles value', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        email: 'valid@example.com',
        full_name: 'Valid Name',
        initial_roles: ['nonexistent_role'],
      })
      .expect(400);
  });

  // AC8 — unauthenticated request → 401
  it('POST /users — 401 without JWT token', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .send({ email: 'valid@example.com', full_name: 'Valid Name' })
      .expect(401);
  });

  // AC5 — actor without required role → 403
  // Verified via RolesGuard unit tests (staff user cannot obtain JWT with known password
  // since CreateUserHandler generates a random temp password, making login impossible in E2E).
  // The RolesGuard correctly throws ForbiddenException when user.roles lacks 'owner'/'ta'.
});
