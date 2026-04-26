import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';

import { RequestUser } from './jwt-payload.interface';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as RequestUser | undefined;
    const tenantId = request.params['tenantId'];

    if (!tenantId || !user) return true;

    if (user.tenantId !== tenantId) {
      throw new ForbiddenException();
    }
    return true;
  }
}
