import { Entity, Enum, ManyToOne, Property } from '@mikro-orm/core';
import { TenantScopedEntity } from '@shared/entities/tenant-scoped.entity';

import { Category } from './category.entity';

export enum ServiceStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

@Entity({ tableName: 'services' })
export class Service extends TenantScopedEntity {
  @Property({ type: 'varchar', length: 255 })
  name!: string;

  @Property({ type: 'text', nullable: true })
  description?: string;

  @ManyToOne(() => Category, { nullable: true, fieldName: 'category_id' })
  category?: Category;

  @Enum({ items: () => ServiceStatus })
  status: ServiceStatus = ServiceStatus.DRAFT;

  @Property({ type: 'integer' })
  duration_minutes!: number;

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  base_price!: string;
}
