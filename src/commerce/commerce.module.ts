import { ServiceDependency } from '@catalog/entities/service-dependency.entity';
import { Service } from '@catalog/entities/service.entity';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { StaffSchedule } from '@scheduling/entities/staff-schedule.entity';
import { StaffQualification } from '@tenancy/entities/staff-qualification.entity';
import { Tenant } from '@tenancy/entities/tenant.entity';
import { User } from '@tenancy/entities/user.entity';

import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';
import { RefundPolicy } from './entities/refund-policy.entity';
import { SaleOrderItem } from './entities/sale-order-item.entity';
import { SaleOrder } from './entities/sale-order.entity';

@Module({
  imports: [
    MikroOrmModule.forFeature([
      SaleOrder,
      SaleOrderItem,
      RefundPolicy,
      Service,
      ServiceDependency,
      Tenant,
      User,
      StaffQualification,
      StaffSchedule,
    ]),
  ],
  controllers: [CommerceController],
  providers: [CommerceService],
})
export class CommerceModule {}
