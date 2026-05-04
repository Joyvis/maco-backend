import { Entity, Property } from '@mikro-orm/core';
import { TenantScopedEntity } from '@shared/entities/tenant-scoped.entity';

@Entity({ tableName: 'categories' })
export class Category extends TenantScopedEntity {
  @Property({ type: 'varchar', length: 255 })
  name!: string;

  @Property({ type: 'integer', nullable: true })
  display_order?: number;
}
