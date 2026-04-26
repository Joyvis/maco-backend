import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

import { RequestUser } from './jwt-payload.interface';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user as RequestUser;
  },
);
