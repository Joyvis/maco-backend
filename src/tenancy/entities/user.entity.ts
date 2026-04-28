import { Collection, Entity, Enum, OneToMany, Property, Unique } from '@mikro-orm/core';
import { TenantScopedEntity } from '@shared/entities/tenant-scoped.entity';

import { UserRole } from './user-role.entity';

export enum UserState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

@Entity({ tableName: 'users' })
@Unique({ properties: ['tenant_id', 'email'] })
export class User extends TenantScopedEntity {
  @Property({ type: 'varchar', length: 255 })
  email!: string;

  @Property({ type: 'varchar', length: 255 })
  password_hash!: string;

  @Property({ type: 'varchar', length: 255 })
  full_name!: string;

  @Property({ type: 'varchar', length: 50, nullable: true })
  phone?: string;

  @Enum({ items: () => UserState })
  state: UserState = UserState.ACTIVE;

  @Property({ type: 'timestamptz', nullable: true })
  last_login_at?: Date;

  @OneToMany(() => UserRole, (ur) => ur.user)
  roles = new Collection<UserRole>(this);
}
