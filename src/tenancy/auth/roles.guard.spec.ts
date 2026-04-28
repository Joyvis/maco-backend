import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from './roles.decorator';
import { RolesGuard } from './roles.guard';

function makeContext(roles: string[]): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'user-1', tenantId: 'tenant-1', roles } }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    guard = new RolesGuard(reflector);
  });

  it('allows access when no required roles are set', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = makeContext(['staff']);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows access when user has one of the required roles', () => {
    reflector.getAllAndOverride.mockReturnValue(['owner', 'ta']);
    const ctx = makeContext(['owner']);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  // AC5 — actor with STAFF role → 403
  it('throws ForbiddenException when user lacks required roles', () => {
    reflector.getAllAndOverride.mockReturnValue(['owner', 'ta']);
    const ctx = makeContext(['staff']);

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when user has no roles at all', () => {
    reflector.getAllAndOverride.mockReturnValue(['owner']);
    const ctx = makeContext([]);

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when request has no user', () => {
    reflector.getAllAndOverride.mockReturnValue(['owner']);
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: undefined }),
      }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('checks ROLES_KEY metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(['owner']);
    const ctx = makeContext(['owner']);
    guard.canActivate(ctx);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, expect.any(Array));
  });
});
