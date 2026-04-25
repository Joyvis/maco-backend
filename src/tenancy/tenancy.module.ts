import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";
import { TenancyController } from "./tenancy.controller";
import { TenancyService } from "./tenancy.service";
import { CreateTenantHandler } from "./commands/handlers/create-tenant.handler";
import { TenantCreatedHandler } from "./events/handlers/tenant-created.handler";

@Module({
  imports: [CqrsModule],
  controllers: [TenancyController],
  providers: [TenancyService, CreateTenantHandler, TenantCreatedHandler],
})
export class TenancyModule {}
