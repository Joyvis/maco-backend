import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { AuthModule } from './auth/auth.module';
import { CreateTenantHandler } from './commands/handlers/create-tenant.handler';
import { RegisterTenantHandler } from './commands/handlers/register-tenant.handler';
import { Role } from './entities/role.entity';
import { TenantConfig } from './entities/tenant-config.entity';
import { Tenant } from './entities/tenant.entity';
import { UserRole } from './entities/user-role.entity';
import { User } from './entities/user.entity';
import { TenantCreatedHandler } from './events/handlers/tenant-created.handler';
import { TenantOnboardingHandler } from './events/handlers/tenant-onboarding.handler';
import { SignUpController } from './sign-up.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { TenancyController } from './tenancy.controller';
import { TenancyService } from './tenancy.service';

@Module({
  imports: [
    CqrsModule,
    AuthModule,
    MikroOrmModule.forFeature([Tenant, Role, User, UserRole, TenantConfig]),
  ],
  controllers: [TenancyController, SignUpController, StripeWebhookController],
  providers: [
    TenancyService,
    CreateTenantHandler,
    TenantCreatedHandler,
    RegisterTenantHandler,
    TenantOnboardingHandler,
  ],
})
export class TenancyModule {}
