import { Filter, Property } from '@mikro-orm/core';

import { BaseEntity } from './base.entity';

@Filter({
  name: 'tenant',
  cond: (args: { tenantId: string }) => ({ tenant_id: args.tenantId }),
  default: true,
})
export abstract class TenantScopedEntity extends BaseEntity {
  @Property({ type: 'uuid' })
  tenant_id!: string;
}
