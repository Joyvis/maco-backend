import { Entity, Enum, ManyToOne } from '@mikro-orm/core';
import { TenantScopedEntity } from '@shared/entities/tenant-scoped.entity';

import { Combo } from './combo.entity';
import { Product } from './product.entity';
import { Service } from './service.entity';

export enum ComboItemType {
  SERVICE = 'service',
  PRODUCT = 'product',
}

@Entity({ tableName: 'combo_items' })
export class ComboItem extends TenantScopedEntity {
  @ManyToOne(() => Combo, { fieldName: 'combo_id', deleteRule: 'cascade' })
  combo!: Combo;

  @Enum({ items: () => ComboItemType })
  item_type!: ComboItemType;

  @ManyToOne(() => Service, { fieldName: 'service_id', nullable: true, deleteRule: 'cascade' })
  service?: Service;

  @ManyToOne(() => Product, { fieldName: 'product_id', nullable: true, deleteRule: 'cascade' })
  product?: Product;
}
