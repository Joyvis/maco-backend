import { Service } from '@catalog/entities/service.entity';
import { Entity, ManyToOne, Property } from '@mikro-orm/core';
import { TenantScopedEntity } from '@shared/entities/tenant-scoped.entity';

import { SaleOrder } from './sale-order.entity';

@Entity({ tableName: 'sale_order_items' })
export class SaleOrderItem extends TenantScopedEntity {
  @ManyToOne(() => SaleOrder, { fieldName: 'sale_order_id', deleteRule: 'cascade' })
  sale_order!: SaleOrder;

  @ManyToOne(() => Service, { fieldName: 'service_id' })
  service!: Service;

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  price!: string;

  @Property({ type: 'boolean' })
  is_dependency: boolean = false;
}
