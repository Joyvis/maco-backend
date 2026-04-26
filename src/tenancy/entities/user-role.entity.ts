import { Entity, Enum, ManyToOne } from '@mikro-orm/core';

import { User } from './user.entity';

export enum UserRoleType {
  PLATFORM_ADMIN = 'platform_admin',
  TENANT_ADMIN = 'tenant_admin',
  STAFF = 'staff',
  RECEPTIONIST = 'receptionist',
  CUSTOMER = 'customer',
}

@Entity({ tableName: 'user_roles' })
export class UserRole {
  @ManyToOne(() => User, { primary: true })
  user!: User;

  @Enum({ items: () => UserRoleType, primary: true })
  role!: UserRoleType;
}
