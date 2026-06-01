import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Controller, ForbiddenException, Get, NotFoundException, Query } from '@nestjs/common';
import { Public } from '@tenancy/auth/public.decorator';
import { MagicLinkAttempt } from '@tenancy/entities/magic-link-attempt.entity';
import { Tenant } from '@tenancy/entities/tenant.entity';

interface LastMagicLinkResponse {
  token: string;
  magic_url: string;
  expires_at: string;
  consumed: boolean;
}

const FRONTEND_URL_FALLBACK = 'http://localhost:3000';

/**
 * Mock-only test controller. Mounted ONLY when `NODE_ENV=test` and
 * `MESSAGE_PROVIDER=mock` (see `MessagingModule.register()`). The in-handler
 * env guards are belt-and-suspenders.
 */
@Controller()
export class TestMagicLinkController {
  constructor(
    @InjectRepository(MagicLinkAttempt)
    private readonly attemptRepo: EntityRepository<MagicLinkAttempt>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: EntityRepository<Tenant>,
  ) {}

  @Public()
  @Get('_test/last-magic-link')
  async getLastMagicLink(
    @Query('tenant_slug') tenantSlug: string,
    @Query('phone') phoneE164: string,
    @Query('include_consumed') includeConsumed?: string,
  ): Promise<LastMagicLinkResponse> {
    if (process.env.NODE_ENV !== 'test') {
      throw new ForbiddenException('Test-only endpoint');
    }
    if ((process.env.MESSAGE_PROVIDER ?? 'mock').toLowerCase() !== 'mock') {
      throw new ForbiddenException('Mock message provider is not active');
    }

    const tenant = await this.tenantRepo.findOne({ slug: tenantSlug }, { filters: false });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const where: Record<string, unknown> = {
      tenant_id: tenant.id,
      phone_e164: phoneE164,
    };
    if (includeConsumed !== 'true') {
      where['consumed_at'] = null;
    }

    const attempt = await this.attemptRepo.findOne(where, {
      filters: false,
      orderBy: { created_at: 'desc' },
    });
    if (!attempt) {
      throw new NotFoundException('No magic link found');
    }

    const frontendUrl = (process.env.FRONTEND_URL ?? FRONTEND_URL_FALLBACK).replace(/\/$/, '');
    const magicUrl = `${frontendUrl}/shop/${tenantSlug}/auth/verify?token=${attempt.token}`;

    return {
      token: attempt.token,
      magic_url: magicUrl,
      expires_at: attempt.expires_at.toISOString(),
      consumed: attempt.consumed_at !== null && attempt.consumed_at !== undefined,
    };
  }
}
