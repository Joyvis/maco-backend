import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CatalogModule } from './catalog/catalog.module';
import { CommerceModule } from './commerce/commerce.module';
import { FinanceModule } from './finance/finance.module';
import { InventoryModule } from './inventory/inventory.module';
import { NotificationModule } from './notification/notification.module';
import { PricingModule } from './pricing/pricing.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { SharedModule } from './shared/shared.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { SupportModule } from './support/support.module';
import { TenancyModule } from './tenancy/tenancy.module';

@Module({
  imports: [
    SharedModule,
    TenancyModule,
    CatalogModule,
    CommerceModule,
    SchedulingModule,
    FinanceModule,
    InventoryModule,
    PricingModule,
    SubscriptionModule,
    SupportModule,
    NotificationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
