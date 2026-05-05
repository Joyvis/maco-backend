import { Entity, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { TenantScopedEntity } from '@shared/entities/tenant-scoped.entity';

import { Product } from './product.entity';
import { Service } from './service.entity';

@Entity({ tableName: 'service_consumptions' })
@Unique({ properties: ['service', 'product'] })
export class ServiceConsumption extends TenantScopedEntity {
  @ManyToOne(() => Service, { fieldName: 'service_id', deleteRule: 'cascade' })
  service!: Service;

  @ManyToOne(() => Product, { fieldName: 'product_id', deleteRule: 'cascade' })
  product!: Product;

  @Property({ type: 'decimal', precision: 12, scale: 3 })
  quantity!: string;
}
