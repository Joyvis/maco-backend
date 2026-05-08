import { Entity, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { TenantScopedEntity } from '@shared/entities/tenant-scoped.entity';

import { Service } from './service.entity';

@Entity({ tableName: 'service_dependencies' })
@Unique({ properties: ['service', 'depends_on_service'] })
export class ServiceDependency extends TenantScopedEntity {
  @ManyToOne(() => Service, { fieldName: 'service_id', deleteRule: 'cascade' })
  service!: Service;

  @ManyToOne(() => Service, { fieldName: 'depends_on_service_id', deleteRule: 'cascade' })
  depends_on_service!: Service;

  @Property({ type: 'boolean' })
  auto_include: boolean = true;
}
