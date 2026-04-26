import { ExecutionContext } from '@nestjs/common';
import { CUSTOM_ROUTE_ARGS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { CurrentUser } from './current-user.decorator';
import { RequestUser } from './jwt-payload.interface';

function extractDecoratorFactory(
  decorator: (target: object, key: string, index: number) => void,
): (data: unknown, ctx: ExecutionContext) => unknown {
  class Host {
    method() {}
  }
  decorator(Host.prototype, 'method', 0);

  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, Host, 'method') as Record<
    string,
    { factory: (data: unknown, ctx: ExecutionContext) => unknown }
  >;
  const key = Object.keys(meta).find((k) => k.includes(CUSTOM_ROUTE_ARGS_METADATA as string))!;
  return meta[key].factory;
}

describe('CurrentUser decorator', () => {
  it('extracts request.user from the HTTP context', () => {
    const requestUser: RequestUser = { id: 'user-uuid', tenantId: 'tenant-uuid', roles: ['staff'] };
    const mockRequest = { user: requestUser };
    const mockCtx = {
      switchToHttp: () => ({ getRequest: () => mockRequest }),
    } as unknown as ExecutionContext;

    const applied = (CurrentUser as unknown as () => typeof decorator)();
    const decorator = applied as unknown as (
      target: object,
      key: string,
      index: number,
    ) => void;
    const factory = extractDecoratorFactory(decorator);
    const result = factory(undefined, mockCtx);

    expect(result).toEqual(requestUser);
  });
});
