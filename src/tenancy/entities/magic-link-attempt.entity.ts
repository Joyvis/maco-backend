import { Entity, Index, Property } from '@mikro-orm/core';
import { TenantScopedEntity } from '@shared/entities/tenant-scoped.entity';

@Entity({ tableName: 'magic_link_attempts' })
@Index({ properties: ['tenant_id', 'phone_e164'] })
@Index({ properties: ['token_hash'] })
export class MagicLinkAttempt extends TenantScopedEntity {
  @Property({ type: 'varchar', length: 20 })
  phone_e164!: string;

  @Property({ type: 'varchar', length: 64 })
  token!: string;

  @Property({ type: 'varchar', length: 128 })
  token_hash!: string;

  @Property({ type: 'timestamptz' })
  expires_at!: Date;

  @Property({ type: 'timestamptz', nullable: true })
  consumed_at?: Date;

  @Property({ type: 'uuid', nullable: true })
  user_id?: string;
}
