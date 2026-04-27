import { Entity, ManyToOne } from '@mikro-orm/core';

import { Role } from './role.entity';
import { User } from './user.entity';

@Entity({ tableName: 'user_roles' })
export class UserRole {
  @ManyToOne(() => User, { primary: true })
  user!: User;

  @ManyToOne(() => Role, { primary: true })
  role!: Role;
}
