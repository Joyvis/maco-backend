import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { AuthModule } from './auth/auth.module';
import { CreateTenantHandler } from './commands/handlers/create-tenant.handler';
import { TenantCreatedHandler } from './events/handlers/tenant-created.handler';
import { TenancyController } from './tenancy.controller';
import { TenancyService } from './tenancy.service';

@Module({
  imports: [CqrsModule, AuthModule],
  controllers: [TenancyController],
  providers: [TenancyService, CreateTenantHandler, TenantCreatedHandler],
})
export class TenancyModule {}
