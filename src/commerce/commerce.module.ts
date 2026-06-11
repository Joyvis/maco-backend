import { ComboItem } from '@catalog/entities/combo-item.entity';
import { Combo } from '@catalog/entities/combo.entity';
import { Product } from '@catalog/entities/product.entity';
import { ServiceDependency } from '@catalog/entities/service-dependency.entity';
import { Service } from '@catalog/entities/service.entity';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { StaffSchedule } from '@scheduling/entities/staff-schedule.entity';
import { SchedulingModule } from '@scheduling/scheduling.module';
import { StaffQualification } from '@tenancy/entities/staff-qualification.entity';
import { TenantConfig } from '@tenancy/entities/tenant-config.entity';
import { Tenant } from '@tenancy/entities/tenant.entity';
import { User } from '@tenancy/entities/user.entity';

import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';
import { RefundPolicy } from './entities/refund-policy.entity';
import { SaleOrderItem } from './entities/sale-order-item.entity';
import { SaleOrder } from './entities/sale-order.entity';

// PaymentsModule is registered globally in AppModule (`PaymentsModule.register()`),
// so CommerceService can inject `PaymentsService` without an explicit import here.

@Module({
  imports: [
    MikroOrmModule.forFeature([
      SaleOrder,
      SaleOrderItem,
      RefundPolicy,
      Service,
      ServiceDependency,
      Combo,
      ComboItem,
      Product,
      Tenant,
      TenantConfig,
      User,
      StaffQualification,
      StaffSchedule,
    ]),
    SchedulingModule,
  ],
  controllers: [CommerceController],
  providers: [CommerceService],
})
export class CommerceModule {}
