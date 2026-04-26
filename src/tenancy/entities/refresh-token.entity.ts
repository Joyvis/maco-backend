import { Entity, Index, ManyToOne, Property } from '@mikro-orm/core';
import { BaseEntity } from '@shared/entities/base.entity';

import { User } from './user.entity';

@Entity({ tableName: 'refresh_tokens' })
@Index({ properties: ['user'] })
@Index({ properties: ['token_hash'] })
export class RefreshToken extends BaseEntity {
  @ManyToOne(() => User)
  user!: User;

  @Property({ type: 'varchar', length: 255 })
  token_hash!: string;

  @Property({ type: 'timestamptz' })
  expires_at!: Date;

  @Property({ type: 'timestamptz', nullable: true })
  revoked_at?: Date;
}
