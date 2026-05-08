import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { Category } from './entities/category.entity';
import { ComboItem } from './entities/combo-item.entity';
import { Combo } from './entities/combo.entity';
import { Product } from './entities/product.entity';
import { ServiceConsumption } from './entities/service-consumption.entity';
import { ServiceDependency } from './entities/service-dependency.entity';
import { Service } from './entities/service.entity';

@Module({
  imports: [
    MikroOrmModule.forFeature([
      Product,
      Category,
      Service,
      ServiceConsumption,
      ServiceDependency,
      Combo,
      ComboItem,
    ]),
  ],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
