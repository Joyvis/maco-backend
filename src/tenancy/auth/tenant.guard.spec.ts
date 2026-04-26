import { ExecutionContext, ForbiddenException } from '@nestjs/common';

import { TenantGuard } from './tenant.guard';

const makeCtx = (user: unknown, params: Record<string, string>): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user, params }),
    }),
  }) as unknown as ExecutionContext;

describe('TenantGuard', () => {
  let guard: TenantGuard;
  beforeEach(() => (guard = new TenantGuard()));

  // AC16: same tenant → allowed
  it('allows when user tenant matches route tenantId param', () => {
    const ctx = makeCtx({ tenantId: 'tenant-A' }, { tenantId: 'tenant-A' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  // AC15: different tenant → 403
  it('throws ForbiddenException when user tenant does not match route tenantId', () => {
    const ctx = makeCtx({ tenantId: 'tenant-A' }, { tenantId: 'tenant-B' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  // no tenantId param → pass through
  it('allows when no tenantId param is present in route', () => {
    const ctx = makeCtx({ tenantId: 'tenant-A' }, {});
    expect(guard.canActivate(ctx)).toBe(true);
  });

  // no user → pass through (let JwtAuthGuard handle it)
  it('allows when request has no user', () => {
    const ctx = makeCtx(undefined, { tenantId: 'tenant-B' });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
