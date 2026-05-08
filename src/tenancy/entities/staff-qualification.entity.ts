import { Service } from '@catalog/entities/service.entity';
import { Entity, ManyToOne, Unique } from '@mikro-orm/core';
import { TenantScopedEntity } from '@shared/entities/tenant-scoped.entity';

import { User } from './user.entity';

@Entity({ tableName: 'staff_qualifications' })
@Unique({ properties: ['user', 'service'] })
export class StaffQualification extends TenantScopedEntity {
  @ManyToOne(() => User, { fieldName: 'user_id', deleteRule: 'cascade' })
  user!: User;

  @ManyToOne(() => Service, { fieldName: 'service_id', deleteRule: 'cascade' })
  service!: Service;
}
