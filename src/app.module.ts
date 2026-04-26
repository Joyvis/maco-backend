import { MikroOrmModule, MikroOrmMiddleware } from '@mikro-orm/nestjs';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import mikroOrmConfig from '../mikro-orm.config';

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
    MikroOrmModule.forRoot(mikroOrmConfig),
    CqrsModule.forRoot(),
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MikroOrmMiddleware).forRoutes('*');
  }
}
