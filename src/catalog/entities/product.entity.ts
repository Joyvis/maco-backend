import { Entity, Enum, ManyToOne, Property } from '@mikro-orm/core';
import { TenantScopedEntity } from '@shared/entities/tenant-scoped.entity';

import { Category } from './category.entity';

export enum ProductUnit {
  ML = 'ml',
  G = 'g',
  UNIT = 'unit',
  KG = 'kg',
  L = 'l',
}

export enum ProductStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

@Entity({ tableName: 'products' })
export class Product extends TenantScopedEntity {
  @Property({ type: 'varchar', length: 255 })
  name!: string;

  @Property({ type: 'text', nullable: true })
  description?: string;

  @ManyToOne(() => Category, { nullable: true, fieldName: 'category_id' })
  category?: Category;

  @Enum({ items: () => ProductUnit })
  unit!: ProductUnit;

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  base_price!: string;

  @Enum({ items: () => ProductStatus })
  status: ProductStatus = ProductStatus.DRAFT;
}
