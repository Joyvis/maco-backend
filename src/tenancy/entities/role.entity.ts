import { Entity, Property } from '@mikro-orm/core';
import { TenantScopedEntity } from '@shared/entities/tenant-scoped.entity';

@Entity({ tableName: 'roles' })
export class Role extends TenantScopedEntity {
  @Property({ type: 'varchar', length: 100 })
  name!: string;

  @Property({ type: 'boolean' })
  is_system: boolean = false;
}
