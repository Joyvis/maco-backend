import { SaleOrder } from '@commerce/entities/sale-order.entity';
import { Entity, Enum, Index, ManyToOne, OneToOne, Property, Unique } from '@mikro-orm/core';
import { TenantScopedEntity } from '@shared/entities/tenant-scoped.entity';
import { User } from '@tenancy/entities/user.entity';

export enum PaymentState {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export enum PaymentProviderName {
  MOCK = 'mock',
  STONE = 'stone',
}

export const TERMINAL_PAYMENT_STATES: ReadonlyArray<PaymentState> = [
  PaymentState.SUCCEEDED,
  PaymentState.FAILED,
  PaymentState.EXPIRED,
  PaymentState.CANCELLED,
];

export interface PaymentMetadata {
  return_urls?: {
    success: string;
    cancel: string;
  };
  simulated_outcome?: 'auto_fail' | 'auto_timeout' | null;
  /** Free-form bag for provider-specific extras (e.g., Stone's order_id). */
  [key: string]: unknown;
}

@Entity({ tableName: 'payments' })
@Index({ properties: ['tenant_id', 'state', 'expires_at'] })
export class Payment extends TenantScopedEntity {
  @OneToOne(() => SaleOrder, { fieldName: 'sale_order_id', owner: true })
  @Unique()
  sale_order!: SaleOrder;

  @ManyToOne(() => User, { fieldName: 'customer_id' })
  customer!: User;

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  amount!: string;

  @Property({ type: 'varchar', length: 8, default: 'BRL' })
  currency: string = 'BRL';

  @Enum({ items: () => PaymentState })
  state: PaymentState = PaymentState.PENDING;

  @Enum({ items: () => PaymentProviderName })
  provider!: PaymentProviderName;

  @Index()
  @Property({ type: 'varchar', length: 128, nullable: true })
  provider_session_id?: string;

  @Property({ type: 'jsonb' })
  provider_metadata: PaymentMetadata = {};

  @Property({ type: 'text', nullable: true })
  error_message?: string;

  @Property({ type: 'timestamptz' })
  expires_at!: Date;
}
