import * as crypto from 'crypto';

import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { RefreshToken } from '../entities/refresh-token.entity';
import { Tenant, TenantStatus } from '../entities/tenant.entity';
import { User, UserState } from '../entities/user.entity';
import { UserLoggedInEvent } from '../events/user-logged-in.event';

import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './jwt-payload.interface';

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
    private readonly eventBus: EventBus,
  ) {}

  async login(dto: LoginDto, ipAddress: string, userAgent: string): Promise<AuthResponseDto> {
    const user = await this.userRepo.findOne(
      { email: dto.email },
      { filters: { tenant: false }, populate: ['roles.role'] as never },
    );

    if (!user) {
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
