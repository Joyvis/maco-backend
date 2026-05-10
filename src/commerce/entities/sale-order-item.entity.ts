import { Combo } from '@catalog/entities/combo.entity';
import { Product } from '@catalog/entities/product.entity';
import { Service } from '@catalog/entities/service.entity';
import { Entity, Enum, ManyToOne, Property } from '@mikro-orm/core';
import { TenantScopedEntity } from '@shared/entities/tenant-scoped.entity';
import { User } from '@tenancy/entities/user.entity';

import { SaleOrder } from './sale-order.entity';

export enum SaleOrderItemType {
  SERVICE = 'service',
  PRODUCT = 'product',
  COMBO = 'combo',
}

export interface ComboComponentSnapshot {
  catalog_item_type: 'service' | 'product';
  catalog_item_id: string;
  name: string;
  base_price: number;
  duration_minutes?: number;
  quantity: number;
  assigned_staff_id?: string;
  slot_start_at?: string;
  slot_end_at?: string;
}

@Entity({ tableName: 'sale_order_items' })
export class SaleOrderItem extends TenantScopedEntity {
  @ManyToOne(() => SaleOrder, { fieldName: 'sale_order_id', deleteRule: 'cascade' })
  sale_order!: SaleOrder;

  @Enum({ items: () => SaleOrderItemType, fieldName: 'catalog_item_type' })
  catalog_item_type!: SaleOrderItemType;

  @Property({ type: 'uuid', fieldName: 'catalog_item_id' })
  catalog_item_id!: string;

  @ManyToOne(() => Service, { fieldName: 'service_id', nullable: true })
  service?: Service;

  @ManyToOne(() => Product, { fieldName: 'product_id', nullable: true })
  product?: Product;

  @ManyToOne(() => Combo, { fieldName: 'combo_id', nullable: true })
  combo?: Combo;

  @ManyToOne(() => User, { fieldName: 'assigned_staff_id', nullable: true })
  assigned_staff?: User;

  @Property({ type: 'timestamptz', nullable: true })
  slot_start_at?: Date;

  @Property({ type: 'timestamptz', nullable: true })
  slot_end_at?: Date;

  @Property({ type: 'integer' })
  quantity: number = 1;

  @Property({ type: 'json', nullable: true })
  combo_components?: ComboComponentSnapshot[];

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  price!: string;

  @Property({ type: 'boolean' })
  is_dependency: boolean = false;
}
