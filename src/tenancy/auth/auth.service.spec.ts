import { EntityRepository } from '@mikro-orm/core';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { RefreshToken } from '../entities/refresh-token.entity';
import { User, UserState } from '../entities/user.entity';

import { AuthService } from './auth.service';

const makeUser = (overrides: Partial<User> = {}): User => {
  const user = Object.assign(new User(), {
    id: 'user-uuid',
    tenant_id: 'tenant-uuid',
    email: 'user@test.com',
    password_hash: '$2b$10$hashedpassword',
    full_name: 'Test User',
    state: UserState.ACTIVE,
    roles: { isInitialized: () => true, getItems: () => [] },
    ...overrides,
  });
  return user;
};

const makeRefreshToken = (overrides: Partial<RefreshToken> = {}): RefreshToken =>
  Object.assign(new RefreshToken(), {
    id: 'token-uuid',
    user: { id: 'user-uuid' } as User,
    token_hash: '$2b$10$hash',
    expires_at: new Date(Date.now() + 604800000),
    revoked_at: undefined,
    created_at: new Date(),
    ...overrides,
  });

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: jest.Mocked<{ findOne: jest.Mock; findOneOrFail: jest.Mock }>;
  let refreshTokenRepo: jest.Mocked<{
    find: jest.Mock;
    create: jest.Mock;
    nativeUpdate: jest.Mock;
    getEntityManager: jest.Mock;
  }>;
  let jwtService: jest.Mocked<Pick<JwtService, 'sign' | 'verify'>>;
  let em: jest.Mocked<{ persistAndFlush: jest.Mock }>;

  beforeEach(() => {
    em = { persistAndFlush: jest.fn().mockResolvedValue(undefined) };
    userRepo = { findOne: jest.fn(), findOneOrFail: jest.fn() };
    refreshTokenRepo = {
      find: jest.fn(),
      create: jest.fn(),
      nativeUpdate: jest.fn().mockResolvedValue(undefined),
      getEntityManager: jest.fn().mockReturnValue(em),
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('signed-token'),
      verify: jest.fn(),
    };

    service = new AuthService(
      userRepo as unknown as EntityRepository<User>,
      refreshTokenRepo as unknown as EntityRepository<RefreshToken>,
      jwtService as unknown as JwtService,
    );
  });

  // --- login ---

  // AC1: successful login
  it('login: returns token pair for valid credentials and active user', async () => {
    const passwordHash = await bcrypt.hash('Password1!', 10);
    const user = makeUser({ password_hash: passwordHash });
    userRepo.findOne.mockResolvedValue(user);
    refreshTokenRepo.create.mockReturnValue(makeRefreshToken());

    const result = await service.login({ email: 'user@test.com', password: 'Password1!' });

    expect(result.access_token).toBeDefined();
    expect(result.refresh_token).toBeDefined();
    expect(result.token_type).toBe('Bearer');
    expect(result.expires_in).toBe(900);
    expect(em.persistAndFlush).toHaveBeenCalled();
    expect(userRepo.findOne).toHaveBeenCalledWith(
      { email: 'user@test.com' },
      expect.objectContaining({ filters: { tenant: false } }),
    );
  });

  // AC2: wrong password → 401
  it('login: throws UnauthorizedException for wrong password', async () => {
    const user = makeUser({ password_hash: await bcrypt.hash('correct', 10) });
    userRepo.findOne.mockResolvedValue(user);

    await expect(service.login({ email: 'user@test.com', password: 'wrong' })).rejects.toThrow(
      new UnauthorizedException('Invalid credentials'),
    );
    expect(em.persistAndFlush).not.toHaveBeenCalled();
  });

  // AC3: email not found → 401 (same message as wrong password)
  it('login: throws UnauthorizedException for non-existent email', async () => {
    userRepo.findOne.mockResolvedValue(null);

    await expect(service.login({ email: 'nobody@test.com', password: 'any' })).rejects.toThrow(
      new UnauthorizedException('Invalid credentials'),
    );
  });

  // AC4: inactive user → 403
  it('login: throws ForbiddenException for inactive user', async () => {
    const passwordHash = await bcrypt.hash('Password1!', 10);
    const user = makeUser({ password_hash: passwordHash, state: UserState.INACTIVE });
    userRepo.findOne.mockResolvedValue(user);

    await expect(service.login({ email: 'user@test.com', password: 'Password1!' })).rejects.toThrow(
      new ForbiddenException('Account is not active'),
    );
  });

  // AC4: suspended user → 403
  it('login: throws ForbiddenException for suspended user', async () => {
    const passwordHash = await bcrypt.hash('Password1!', 10);
    const user = makeUser({ password_hash: passwordHash, state: UserState.SUSPENDED });
    userRepo.findOne.mockResolvedValue(user);

    await expect(service.login({ email: 'user@test.com', password: 'Password1!' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  // --- refresh ---

  // AC11: successful token rotation
  it('refresh: rotates refresh token and returns new pair', async () => {
    const user = makeUser();
    const token = makeRefreshToken({ token_hash: await bcrypt.hash('raw-token', 10) });
    jwtService.verify.mockReturnValue({ sub: 'user-uuid', tenant_id: 'tenant-uuid', roles: [] });
    refreshTokenRepo.find.mockResolvedValue([token]);
    refreshTokenRepo.create.mockReturnValue(makeRefreshToken());
    userRepo.findOneOrFail.mockResolvedValue(user);

    const result = await service.refresh('raw-token');

    expect(result.access_token).toBeDefined();
    expect(result.refresh_token).toBeDefined();
    expect(token.revoked_at).toBeDefined();
  });

  // AC12: expired token (JWT verify throws)
  it('refresh: throws UnauthorizedException for expired JWT', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    await expect(service.refresh('expired-token')).rejects.toThrow(
      new UnauthorizedException('Invalid refresh token'),
    );
  });

  // AC13: revoked token replay → revoke all
  it('refresh: throws UnauthorizedException and revokes all tokens for revoked token replay', async () => {
    const revokedToken = makeRefreshToken({
      token_hash: await bcrypt.hash('raw-token', 10),
      revoked_at: new Date(),
    });
    jwtService.verify.mockReturnValue({ sub: 'user-uuid', tenant_id: 'tenant-uuid', roles: [] });
    refreshTokenRepo.find.mockResolvedValue([revokedToken]);

    await expect(service.refresh('raw-token')).rejects.toThrow(
      new UnauthorizedException('Invalid refresh token'),
    );
    expect(refreshTokenRepo.nativeUpdate).toHaveBeenCalledWith(
      { user: 'user-uuid' },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      { revoked_at: expect.any(Date) },
    );
  });

  // AC14: invalid / malformed token
  it('refresh: throws UnauthorizedException for malformed token', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('invalid token');
    });

    await expect(service.refresh('not-a-jwt')).rejects.toThrow(UnauthorizedException);
  });

  // AC12: expired in DB (past expires_at, valid JWT)
  it('refresh: throws UnauthorizedException for token past expires_at', async () => {
    const expiredToken = makeRefreshToken({
      token_hash: await bcrypt.hash('raw-token', 10),
      expires_at: new Date(Date.now() - 1000),
    });
    jwtService.verify.mockReturnValue({ sub: 'user-uuid', tenant_id: 'tenant-uuid', roles: [] });
    refreshTokenRepo.find.mockResolvedValue([expiredToken]);

    await expect(service.refresh('raw-token')).rejects.toThrow(
      new UnauthorizedException('Invalid refresh token'),
    );
  });
});
