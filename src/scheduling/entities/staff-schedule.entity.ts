import { Entity, ManyToOne, Property } from '@mikro-orm/core';
import { TenantScopedEntity } from '@shared/entities/tenant-scoped.entity';
import { User } from '@tenancy/entities/user.entity';

@Entity({ tableName: 'staff_schedules' })
export class StaffSchedule extends TenantScopedEntity {
  @ManyToOne(() => User, { fieldName: 'user_id', deleteRule: 'cascade' })
  user!: User;

  @Property({ type: 'integer' })
  day_of_week!: number;

  @Property({ type: 'time' })
  start_time!: string;

  @Property({ type: 'time' })
  end_time!: string;
}
