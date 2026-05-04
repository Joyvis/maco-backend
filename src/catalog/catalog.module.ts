import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { Category } from './entities/category.entity';
import { Product } from './entities/product.entity';

@Module({
  imports: [MikroOrmModule.forFeature([Product, Category])],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
