import { Collection, Entity, Enum, OneToMany, Property } from '@mikro-orm/core';
import { TenantScopedEntity } from '@shared/entities/tenant-scoped.entity';

import { ComboItem } from './combo-item.entity';

export enum ComboStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

@Entity({ tableName: 'combos' })
export class Combo extends TenantScopedEntity {
  @Property({ type: 'varchar', length: 255 })
  name!: string;

  @Property({ type: 'text', nullable: true })
  description?: string;

  @Property({ type: 'decimal', precision: 5, scale: 2 })
  discount_percentage!: string;

  @Enum({ items: () => ComboStatus })
  status: ComboStatus = ComboStatus.ACTIVE;

  @OneToMany(() => ComboItem, (item) => item.combo, { orphanRemoval: true })
  items = new Collection<ComboItem>(this);
}
