import { Opt, PrimaryKey, Property } from '@mikro-orm/core';
import { uuidv7 } from 'uuidv7';

export abstract class BaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string & Opt = uuidv7();

  @Property({ type: 'timestamptz', defaultRaw: 'now()' })
  created_at: Date & Opt = new Date();

  @Property({ type: 'timestamptz', defaultRaw: 'now()', onUpdate: () => new Date() })
  updated_at: Date & Opt = new Date();
}
