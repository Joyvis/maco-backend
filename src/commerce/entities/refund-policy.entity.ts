import { Entity, Property } from '@mikro-orm/core';
import { TenantScopedEntity } from '@shared/entities/tenant-scoped.entity';

@Entity({ tableName: 'refund_policies' })
export class RefundPolicy extends TenantScopedEntity {
  @Property({ type: 'varchar', length: 500 })
  description!: string;

  @Property({ type: 'integer' })
  refund_percentage!: number;

  @Property({ type: 'boolean' })
  is_active: boolean = true;
}
