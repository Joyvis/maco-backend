import * as crypto from 'crypto';

import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { MESSAGE_PROVIDER, MessageProvider } from '../../messaging/message-provider.interface';
import { normalizeBrPhone } from '../../shared/phone';
import { MagicLinkAttempt } from '../entities/magic-link-attempt.entity';
import { MagicLinkRateLimit } from '../entities/magic-link-rate-limit.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { Role } from '../entities/role.entity';
import { Tenant, TenantStatus } from '../entities/tenant.entity';
import { UserAuthMethod } from '../entities/user-auth-method.enum';
import { UserRole } from '../entities/user-role.entity';
import { User, UserState } from '../entities/user.entity';
import { UserLoggedInEvent } from '../events/user-logged-in.event';

import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './jwt-payload.interface';

const MAGIC_LINK_TTL_MINUTES = 10;
const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_ATTEMPTS = 3;
const FRONTEND_URL_FALLBACK = 'http://localhost:3000';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: EntityRepository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: EntityRepository<RefreshToken>,
    private readonly jwtService: JwtService,
    @InjectRepository(Tenant)
    private readonly tenantRepo: EntityRepository<Tenant>,
    @InjectRepository(MagicLinkAttempt)
    private readonly magicLinkRepo: EntityRepository<MagicLinkAttempt>,
    @InjectRepository(MagicLinkRateLimit)
    private readonly rateLimitRepo: EntityRepository<MagicLinkRateLimit>,
    @InjectRepository(Role)
    private readonly roleRepo: EntityRepository<Role>,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: EntityRepository<UserRole>,
    @Inject(MESSAGE_PROVIDER)
    private readonly messageProvider: MessageProvider,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Starts the phone login flow. Anti-enumeration: always resolves 200 from
   * the controller, regardless of whether the tenant exists, the rate limit
   * was exceeded, or the SMS provider failed.
   */
  async startPhoneLogin(tenantSlug: string, rawPhone: string): Promise<void> {
    const phoneE164 = normalizeBrPhone(rawPhone);
    if (!phoneE164) {
      throw new BadRequestException('Invalid phone number');
    }

    const tenant = await this.tenantRepo.findOne({ slug: tenantSlug }, { filters: false });
    if (!tenant) return;
    if (tenant.status !== TenantStatus.ACTIVE && tenant.status !== TenantStatus.TRIAL) {
      return;
    }

    if (await this.isRateLimited(tenant.id, phoneE164)) {
      return;
    }

    const token = crypto.randomBytes(24).toString('base64url');
    const tokenHash = hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MINUTES * 60_000);

    const attempt = this.magicLinkRepo.create({
      tenant_id: tenant.id,
      phone_e164: phoneE164,
      token,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    await this.magicLinkRepo.getEntityManager().persistAndFlush(attempt);

    const frontendUrl = (process.env.FRONTEND_URL ?? FRONTEND_URL_FALLBACK).replace(/\/$/, '');
    const magicUrl = `${frontendUrl}/shop/${tenantSlug}/auth/verify?token=${token}`;

    try {
      await this.messageProvider.sendMagicLink({
        tenantId: tenant.id,
        tenantSlug,
        phoneE164,
        magicUrl,
        expiresAt,
      });
    } catch {
      // Swallow — anti-enumeration. The attempt row stays so retries from the
      // same phone hit the rate limit normally.
    }
  }

  /**
   * Verifies a magic-link token. Single-use; lazy-creates the customer User on
   * first successful verify. Throws 401 for missing / expired / consumed tokens.
   */
  async verifyPhoneLogin(
    rawToken: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<AuthResponseDto> {
    const tokenHash = hashToken(rawToken);
    const attempt = await this.magicLinkRepo.findOne({ token_hash: tokenHash }, { filters: false });
    if (!attempt) {
      throw new UnauthorizedException('Invalid or expired magic link');
    }
    if (attempt.consumed_at) {
      throw new UnauthorizedException('Invalid or expired magic link');
    }
    if (attempt.expires_at <= new Date()) {
      throw new UnauthorizedException('Invalid or expired magic link');
    }

    const tenant = await this.tenantRepo.findOne({ id: attempt.tenant_id }, { filters: false });
    if (!tenant) {
      throw new UnauthorizedException('Invalid or expired magic link');
    }
    if (tenant.status !== TenantStatus.ACTIVE && tenant.status !== TenantStatus.TRIAL) {
      throw new ForbiddenException('Tenant is not active');
    }

    attempt.consumed_at = new Date();

    const synthEmail = `${attempt.phone_e164}@phone.local`;
    let user = await this.userRepo.findOne(
      { tenant_id: tenant.id, email: synthEmail },
      { filters: false, populate: ['roles.role'] as never },
    );

    if (!user) {
      user = await this.lazyCreateCustomer(tenant.id, attempt.phone_e164, synthEmail);
    }

    if (user.state !== UserState.ACTIVE) {
      throw new ForbiddenException('Account is not active');
    }

    attempt.user_id = user.id;

    const loggedInAt = new Date();
    user.last_login_at = loggedInAt;

    const result = await this.generateTokenPair(user);

    this.eventBus.publish(
      new UserLoggedInEvent(user.tenant_id, user.id, ipAddress, userAgent, loggedInAt),
    );

    return result;
  }

  private async isRateLimited(tenantId: string, phoneE164: string): Promise<boolean> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MINUTES * 60_000);

    const row = await this.rateLimitRepo.findOne(
      { tenant_id: tenantId, phone_e164: phoneE164 },
      { filters: false },
    );

    if (!row) {
      const created = this.rateLimitRepo.create({
        tenant_id: tenantId,
        phone_e164: phoneE164,
        window_started_at: now,
        attempt_count: 1,
      });
      await this.rateLimitRepo.getEntityManager().persistAndFlush(created);
      return false;
    }

    if (row.window_started_at < windowStart) {
      row.window_started_at = now;
      row.attempt_count = 1;
      await this.rateLimitRepo.getEntityManager().flush();
      return false;
    }

    if (row.attempt_count >= RATE_LIMIT_MAX_ATTEMPTS) {
      return true;
    }

    row.attempt_count += 1;
    await this.rateLimitRepo.getEntityManager().flush();
    return false;
  }

  private async lazyCreateCustomer(
    tenantId: string,
    phoneE164: string,
    synthEmail: string,
  ): Promise<User> {
    const em = this.userRepo.getEntityManager();

    const customerRole = await this.roleRepo.findOne(
      { tenant_id: tenantId, name: 'customer' },
      { filters: false },
    );
    if (!customerRole) {
      throw new ForbiddenException('Customer role not provisioned for tenant');
    }

    const user = this.userRepo.create({
      tenant_id: tenantId,
      email: synthEmail,
      phone: phoneE164,
      state: UserState.ACTIVE,
      auth_method: UserAuthMethod.PHONE,
    });
    await em.persistAndFlush(user);

    const userRole = this.userRoleRepo.create({ user, role: customerRole });
    await em.persistAndFlush(userRole);

    return this.userRepo.findOneOrFail(
      { id: user.id },
      { filters: false, populate: ['roles.role'] as never },
    );
  }

  async login(dto: LoginDto, ipAddress: string, userAgent: string): Promise<AuthResponseDto> {
    const user = await this.userRepo.findOne(
      { email: dto.email },
      { filters: { tenant: false }, populate: ['roles.role'] as never },
    );

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.password_hash) {
      // Phone-only accounts cannot log in via password.
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password_hash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.state !== UserState.ACTIVE) {
      throw new ForbiddenException('Account is not active');
    }

    const tenant = await this.tenantRepo.findOne({ id: user.tenant_id }, { filters: false });
    if (tenant?.status === TenantStatus.SUSPENDED) {
      throw new ForbiddenException('Tenant suspended');
    }
    if (tenant?.status === TenantStatus.CANCELLED) {
      throw new ForbiddenException('Tenant cancelled');
    }
    if (tenant?.status !== TenantStatus.ACTIVE && tenant?.status !== TenantStatus.TRIAL) {
      throw new ForbiddenException('Tenant is not active');
    }

    const loggedInAt = new Date();
    user.last_login_at = loggedInAt;

    const result = await this.generateTokenPair(user);

    this.eventBus.publish(
      new UserLoggedInEvent(user.tenant_id, user.id, ipAddress, userAgent, loggedInAt),
    );

    return result;
  }

  async refresh(rawToken: string): Promise<AuthResponseDto> {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(rawToken, {
        secret: process.env['JWT_REFRESH_SECRET'] ?? 'fallback-refresh-secret',
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const userId = payload.sub;
    const tokenHash = hashRefreshToken(rawToken);

    const matchedToken = await this.refreshTokenRepo.findOne(
      { user: userId, token_hash: tokenHash },
      { filters: false },
    );

    if (!matchedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (matchedToken.revoked_at) {
      await this.refreshTokenRepo.nativeUpdate({ user: userId }, { revoked_at: new Date() });
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (matchedToken.expires_at < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    matchedToken.revoked_at = new Date();

    const user = await this.userRepo.findOneOrFail(
      { id: userId },
      { filters: { tenant: false }, populate: ['roles.role'] as never },
    );

    return this.generateTokenPair(user);
  }

  private async generateTokenPair(user: User): Promise<AuthResponseDto> {
    const roles = user.roles.isInitialized() ? user.roles.getItems().map((ur) => ur.role.name) : [];

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      tenant_id: user.tenant_id,
      roles,
    };

    const accessTtl = parseInt(process.env['JWT_ACCESS_TTL'] ?? '900', 10);
    const refreshTtl = parseInt(process.env['JWT_REFRESH_TTL'] ?? '604800', 10);

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env['JWT_SECRET'] ?? 'fallback-secret',
      expiresIn: accessTtl,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env['JWT_REFRESH_SECRET'] ?? 'fallback-refresh-secret',
      expiresIn: refreshTtl,
    });

    const refreshTokenEntity = this.refreshTokenRepo.create({
      user,
      token_hash: hashRefreshToken(refreshToken),
      expires_at: new Date(Date.now() + refreshTtl * 1000),
    });
    await this.refreshTokenRepo.getEntityManager().persistAndFlush(refreshTokenEntity);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: accessTtl,
    };
  }
}

function hashRefreshToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('base64');
}

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('base64');
}
