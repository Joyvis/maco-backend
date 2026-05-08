import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from './public.decorator';

const makeCtx = (headers: Record<string, string> = {}): ExecutionContext =>
  ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ headers, user: { tenantId: 'tenant-1' } }),
    }),
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  // AC9: @Public() route skips auth
  it('returns true immediately when route is marked @Public', () => {
    const getAllAndOverride = jest.fn().mockReturnValue(true);
    const reflector = { getAllAndOverride } as unknown as Reflector;

    const guard = new JwtAuthGuard(reflector);
    const ctx = makeCtx();
    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, expect.any(Array));
  });

  // AC6/AC7/AC8: non-public routes delegate to passport
  it('delegates to AuthGuard when route is not @Public', async () => {
    const getAllAndOverride = jest.fn().mockReturnValue(false);
    const reflector = { getAllAndOverride } as unknown as Reflector;

    const guard = new JwtAuthGuard(reflector);
    const superProto = Object.getPrototypeOf(Object.getPrototypeOf(guard)) as {
      canActivate: (ctx: ExecutionContext) => boolean;
    };
    const superCanActivate = jest.spyOn(superProto, 'canActivate').mockReturnValue(true);

    const ctx = makeCtx();
    await guard.canActivate(ctx);

    expect(superCanActivate).toHaveBeenCalled();
  });

  it('rejects when X-Tenant-Id header does not match the JWT tenant', async () => {
    const getAllAndOverride = jest.fn().mockReturnValue(false);
    const reflector = { getAllAndOverride } as unknown as Reflector;

    const guard = new JwtAuthGuard(reflector);
    const superProto = Object.getPrototypeOf(Object.getPrototypeOf(guard)) as {
      canActivate: (ctx: ExecutionContext) => boolean;
    };
    jest.spyOn(superProto, 'canActivate').mockReturnValue(true);

    const ctx = makeCtx({ 'x-tenant-id': 'other-tenant' });
    await expect(guard.canActivate(ctx) as Promise<boolean>).rejects.toThrow('Tenant mismatch');
  });
});
