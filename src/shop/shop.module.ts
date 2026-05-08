import { Category } from '@catalog/entities/category.entity';
import { Service } from '@catalog/entities/service.entity';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { Role } from '@tenancy/entities/role.entity';
import { StaffQualification } from '@tenancy/entities/staff-qualification.entity';
import { Tenant } from '@tenancy/entities/tenant.entity';
import { UserRole } from '@tenancy/entities/user-role.entity';
import { User } from '@tenancy/entities/user.entity';

import { ShopController } from './shop.controller';
import { ShopService } from './shop.service';

@Module({
  imports: [
    MikroOrmModule.forFeature([
      Tenant,
      Service,
      Category,
      User,
      UserRole,
      Role,
      StaffQualification,
    ]),
  ],
  controllers: [ShopController],
  providers: [ShopService],
})
export class ShopModule {}
