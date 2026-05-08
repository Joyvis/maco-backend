import { Service } from '@catalog/entities/service.entity';
import { Collection, Entity, Enum, ManyToOne, OneToMany, Property } from '@mikro-orm/core';
import { TenantScopedEntity } from '@shared/entities/tenant-scoped.entity';
import { User } from '@tenancy/entities/user.entity';

import { SaleOrderItem } from './sale-order-item.entity';

export enum SaleOrderState {
  PENDING_PAYMENT = 'pending_payment',
  PENDING_CHECKOUT = 'pending_checkout',
  CONFIRMED = 'confirmed',
  CHECKED_IN = 'checked_in',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no_show',
}

export const ACTIVE_BOOKING_STATES = [
  SaleOrderState.PENDING_PAYMENT,
  SaleOrderState.PENDING_CHECKOUT,
  SaleOrderState.CONFIRMED,
  SaleOrderState.CHECKED_IN,
  SaleOrderState.IN_PROGRESS,
];

@Entity({ tableName: 'sale_orders' })
export class SaleOrder extends TenantScopedEntity {
  @ManyToOne(() => User, { fieldName: 'customer_id' })
  customer!: User;

  @ManyToOne(() => Service, { fieldName: 'service_id' })
  service!: Service;

  @ManyToOne(() => User, { fieldName: 'staff_id', nullable: true })
  staff?: User;

  @Enum({ items: () => SaleOrderState })
  state!: SaleOrderState;

  @Property({ type: 'timestamptz' })
  scheduled_at!: Date;

  @Property({ type: 'timestamptz' })
  scheduled_end_at!: Date;

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  total_amount!: string;

  @Property({ type: 'boolean' })
  requires_payment: boolean = false;

  @Property({ type: 'text', nullable: true })
  payment_url?: string;

  @Property({ type: 'varchar', length: 64, nullable: true })
  cancellation_reason?: string;

  @Property({ type: 'timestamptz', nullable: true })
  cancelled_at?: Date;

  @OneToMany(() => SaleOrderItem, (i) => i.sale_order)
  items = new Collection<SaleOrderItem>(this);
}
