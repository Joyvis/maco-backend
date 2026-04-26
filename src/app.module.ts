import { UnderscoreNamingStrategy } from '@mikro-orm/core';
import { Migrator } from '@mikro-orm/migrations';
import { MikroOrmModule, MikroOrmMiddleware } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

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
    MikroOrmModule.forRootAsync({
      useFactory: () => ({
        driver: PostgreSqlDriver,
        host: process.env.DATABASE_HOST ?? 'localhost',
        port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
        dbName: process.env.DATABASE_NAME ?? 'maco',
        user: process.env.DATABASE_USER ?? 'maco',
        password: process.env.DATABASE_PASSWORD ?? 'maco',
        entities: ['dist/**/*.entity.js'],
        entitiesTs: ['src/**/*.entity.ts'],
        namingStrategy: UnderscoreNamingStrategy,
        debug: process.env.MIKRO_ORM_DEBUG === 'true',
        migrations: {
          path: 'dist/migrations',
          pathTs: 'src/migrations',
        },
        extensions: [Migrator],
      }),
    }),
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
