import { Entity, Property } from '@mikro-orm/core';
import { TenantScopedEntity } from '@shared/entities/tenant-scoped.entity';

@Entity({ tableName: 'tenant_configs' })
export class TenantConfig extends TenantScopedEntity {
  @Property({ type: 'varchar', length: 255 })
  key!: string;

  @Property({ type: 'text', nullable: true })
  value?: string;
}
