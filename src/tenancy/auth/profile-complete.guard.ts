import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { User } from '../entities/user.entity';

import { ALLOW_INCOMPLETE_PROFILE_KEY } from './allow-incomplete-profile.decorator';
import { RequestUser } from './jwt-payload.interface';
import { IS_PUBLIC_KEY } from './public.decorator';

/** Roles that grant staff-side access. Mirrors the frontend `isCustomerOnlyRoles`. */
const STAFF_ROLES = new Set([
  'owner',
  'ta',
  'staff',
  'receptionist',
  'tenant_admin',
  'platform_admin',
]);

/** A customer-only user is one with the `customer` role and no staff role. */
function isCustomerOnly(roles: string[]): boolean {
  if (!roles || roles.length === 0) return false;
  if (!roles.includes('customer')) return false;
  return !roles.some((r) => STAFF_ROLES.has(r));
}

/**
 * Global guard (runs after {@link JwtAuthGuard}) that blocks customer-only users
 * from performing any action until they have set a name. Phone customers are
 * lazy-created with `full_name = null`; without this gate they could book and
 * use the system anonymously, leaving the front desk unable to identify them.
 *
 * Whitelisted: `@Public()` routes and handlers tagged `@AllowIncompleteProfile()`
 * (the profile read/update endpoints, so the customer can fix their profile).
 */
@Injectable()
export class ProfileCompleteGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(User)
    private readonly userRepo: EntityRepository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const allowIncomplete = this.reflector.getAllAndOverride<boolean>(
      ALLOW_INCOMPLETE_PROFILE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowIncomplete) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as RequestUser | undefined;
    // No authenticated user reaches here on a protected route — JwtAuthGuard
    // (which runs first) would have rejected it. Nothing to gate.
    if (!user) return true;

    // Only customer-only users can lack a name; staff always have one.
    if (!isCustomerOnly(user.roles)) return true;

    const entity = await this.userRepo.findOne(
      { id: user.id, tenant_id: user.tenantId },
      { filters: false },
    );
    const name = entity?.full_name?.trim();
    if (name && name.length > 0) return true;

    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Complete seu perfil informando seu nome para continuar.',
      code: 'profile_incomplete',
    });
  }
}
