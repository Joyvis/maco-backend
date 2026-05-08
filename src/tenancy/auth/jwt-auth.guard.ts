import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Observable, lastValueFrom } from 'rxjs';

import { RequestUser } from './jwt-payload.interface';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return this.authenticateAndCheckTenant(context);
  }

  private async authenticateAndCheckTenant(context: ExecutionContext): Promise<boolean> {
    const result = await resolveCanActivate(super.canActivate(context));
    if (!result) return false;

    const request = context.switchToHttp().getRequest<Request>();
    const headerVal = request.headers['x-tenant-id'];
    const headerTenantId = Array.isArray(headerVal) ? headerVal[0] : headerVal;
    const user = request.user as RequestUser | undefined;
    if (headerTenantId && user && user.tenantId !== headerTenantId) {
      throw new ForbiddenException('Tenant mismatch');
    }
    return true;
  }
}

async function resolveCanActivate(
  value: boolean | Promise<boolean> | Observable<boolean>,
): Promise<boolean> {
  if (typeof value === 'boolean') return value;
  if (value instanceof Promise) return value;
  return lastValueFrom(value);
}
