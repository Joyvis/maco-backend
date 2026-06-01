import { Entity, PrimaryKeyProp, Property } from '@mikro-orm/core';

@Entity({ tableName: 'magic_link_rate_limits' })
export class MagicLinkRateLimit {
  @Property({ type: 'uuid', primary: true })
  tenant_id!: string;

  @Property({ type: 'varchar', length: 20, primary: true })
  phone_e164!: string;

  @Property({ type: 'timestamptz' })
  window_started_at!: Date;

  @Property({ type: 'int' })
  attempt_count!: number;

  [PrimaryKeyProp]?: ['tenant_id', 'phone_e164'];
}
