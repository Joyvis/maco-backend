import { EntityManager } from '@mikro-orm/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { User, UserState } from '../src/tenancy/entities/user.entity';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let em: EntityManager;

  const TENANT_ID = 'e2e-tenant-uuid-0001-000000000001';
  const USER_ID = 'e2e-user-uuid-0001-0000000000001';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    em = moduleFixture.get<EntityManager>(EntityManager).fork();

    // Seed active test user
    const passwordHash = await bcrypt.hash('Password1!', 10);
    await em.upsert(User, {
      id: USER_ID,
      tenant_id: TENANT_ID,
      email: 'user@test.com',
      password_hash: passwordHash,
      full_name: 'Test User',
      state: UserState.ACTIVE,
    });
    await em.flush();
  });

  afterAll(async () => {
    await em.nativeDelete(User, { id: USER_ID });
    await em.flush();
    await app.close();
  });

  // AC1: successful login
  it('POST /auth/login — 200 with token pair for valid credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'user@test.com', password: 'Password1!' })
      .expect(200);

    const body = res.body as Record<string, unknown>;
    expect(body['access_token']).toEqual(expect.any(String));
    expect(body['refresh_token']).toEqual(expect.any(String));
    expect(body['token_type']).toBe('Bearer');
    expect(body['expires_in']).toBe(900);
  });

  // AC2: wrong password → 401
  it('POST /auth/login — 401 for wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'user@test.com', password: 'wrong-password' })
      .expect(401)
      .expect((res) => {
        const body = res.body as { message: string };
        expect(body.message).toBe('Invalid credentials');
      });
  });

  // AC3: non-existent email → 401 same message
  it('POST /auth/login — 401 for non-existent email', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nobody@test.com', password: 'any' })
      .expect(401)
      .expect((res) => {
        const body = res.body as { message: string };
        expect(body.message).toBe('Invalid credentials');
      });
  });

  // AC4: inactive user → 403
  it('POST /auth/login — 403 for inactive user', async () => {
    const inactiveId = 'e2e-inactive-uuid-000000000001';
    const passwordHash = await bcrypt.hash('Password1!', 10);
    await em.upsert(User, {
      id: inactiveId,
      tenant_id: TENANT_ID,
      email: 'inactive@test.com',
      password_hash: passwordHash,
      full_name: 'Inactive User',
      state: UserState.INACTIVE,
    });
    await em.flush();

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'inactive@test.com', password: 'Password1!' })
      .expect(403)
      .expect((res) => {
        const body = res.body as { message: string };
        expect(body.message).toBe('Account is not active');
      });

    await em.nativeDelete(User, { id: inactiveId });
    await em.flush();
  });

  // AC5: validation error — missing email
  it('POST /auth/login — 400 for missing email', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ password: 'Password1!' })
      .expect(400);
  });

  // AC5: validation error — invalid email format
  it('POST /auth/login — 400 for invalid email format', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'not-an-email', password: 'Password1!' })
      .expect(400);
  });

  // AC6: protected route without token → 401
  it('GET / (protected route) — 401 without token', async () => {
    // Remove @Public from a hypothetical protected route; test that bare protected routes fail
    // The AppController's GET / is @Public so we test a non-existent route which still hits guard
    // We'll verify global guard is active via checking app startup context instead
    // For the actual AC6 scenario, we test via the tenancy route
    await request(app.getHttpServer()).get('/tenancy').expect(401);
  });

  // AC9: @Public() route works without token
  it('GET / — 200 without token (@Public route)', async () => {
    await request(app.getHttpServer()).get('/').expect(200);
  });

  // AC11: refresh token rotation
  it('POST /auth/refresh — 200 with new token pair', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'user@test.com', password: 'Password1!' })
      .expect(200);

    const { refresh_token: oldRefreshToken } = loginRes.body as {
      refresh_token: string;
    };

    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: oldRefreshToken })
      .expect(200);

    const refreshBody = refreshRes.body as Record<string, unknown>;
    expect(refreshBody['access_token']).toEqual(expect.any(String));
    expect(refreshBody['refresh_token']).toEqual(expect.any(String));
    expect(refreshBody['token_type']).toBe('Bearer');
    expect(refreshBody['expires_in']).toBe(900);

    // Old refresh token should be revoked (replay → 401)
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: oldRefreshToken })
      .expect(401);
  });

  // AC14: invalid/malformed refresh token → 401
  it('POST /auth/refresh — 401 for invalid token', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: 'not.a.valid.jwt' })
      .expect(401);
  });

  // AC7: protected route with valid token → passes
  it('GET /tenancy — passes with valid access token', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'user@test.com', password: 'Password1!' })
      .expect(200);

    const { access_token } = loginRes.body as { access_token: string };

    // TenancyController has no GET / handler so it returns 404, not 401
    const res = await request(app.getHttpServer())
      .get('/tenancy')
      .set('Authorization', `Bearer ${access_token}`);

    expect(res.status).not.toBe(401);
  });
});
