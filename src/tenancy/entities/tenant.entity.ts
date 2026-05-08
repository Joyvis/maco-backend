import { Entity, Enum, Property } from '@mikro-orm/core';
import { BaseEntity } from '@shared/entities/base.entity';

export enum AccountType {
  PLATFORM = 'platform',
  WLC = 'wlc',
  STANDARD = 'standard',
}

export enum TenantStatus {
  ACTIVE = 'active',
  TRIAL = 'trial',
  SUSPENDED = 'suspended',
  CANCELLED = 'cancelled',
  PENDING_PAYMENT = 'pending_payment',
}

export enum SubscriptionType {
  FREE_TRIAL = 'free_trial',
  PAID = 'paid',
}

@Entity({ tableName: 'tenants' })
export class Tenant extends BaseEntity {
  @Property({ type: 'varchar', length: 255 })
  name!: string;

  @Enum({ items: () => AccountType })
  account_type!: AccountType;

  @Property({ type: 'uuid', nullable: true })
  parent_tenant_id?: string;

  @Enum({ items: () => TenantStatus })
  status!: TenantStatus;

  @Property({ type: 'uuid' })
  plan_id!: string;

  @Enum({ items: () => SubscriptionType })
  subscription_type!: SubscriptionType;

  @Property({ type: 'timestamptz', nullable: true })
  trial_ends_at?: Date;

  @Property({ type: 'varchar', length: 255, nullable: true })
  slug?: string;

  @Property({ type: 'varchar', length: 1024, nullable: true })
  logo_url?: string;

  @Property({ type: 'varchar', length: 255, nullable: true })
  city?: string;

  @Property({ type: 'decimal', precision: 3, scale: 2, nullable: true })
  rating?: string;
}
