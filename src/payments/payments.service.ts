import { SaleOrder, SaleOrderState } from '@commerce/entities/sale-order.entity';
import { EntityManager } from '@mikro-orm/core';
import { GoneException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { User } from '@tenancy/entities/user.entity';

import { Payment, PaymentProviderName, PaymentState } from './entities/payment.entity';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
  PaymentWebhookEvent,
} from './payment-provider.interface';

const FRONTEND_URL_FALLBACK = 'http://localhost:3000';

const noTenantFilter = () => ({ filters: { tenant: false } });

export interface StartCheckoutResult {
  payment: Payment;
  paymentUrl: string;
}

export interface WebhookHandleResult {
  /** `accepted` = state transitioned. `replay` = idempotent no-op (same outcome).
   *  `terminal_mismatch` = session in a terminal state with a different outcome (returns 410). */
  status: 'accepted' | 'replay' | 'terminal_mismatch';
  payment: Payment;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly em: EntityManager,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Called from `commerce.service.ts createBooking` while inside the booking
   * transaction. Creates the Payment row and asks the provider for a checkout
   * URL. Both writes happen on the caller's `em` so a provider failure rolls
   * the booking back atomically.
   */
  async startCheckout(em: EntityManager, order: SaleOrder): Promise<StartCheckoutResult> {
    const frontendUrl = (process.env.FRONTEND_URL ?? FRONTEND_URL_FALLBACK).replace(/\/$/, '');
    const successReturnUrl = `${frontendUrl}/booking/${order.id}/success`;
    const cancelReturnUrl = `${frontendUrl}/booking/${order.id}/cancelled`;

    const checkout = await this.provider.createCheckout({
      order,
      successReturnUrl,
      cancelReturnUrl,
    });

    const payment = new Payment();
    payment.tenant_id = order.tenant_id;
    payment.sale_order = order;
    payment.customer = order.customer;
    payment.amount = order.total_amount;
    payment.currency = 'BRL';
    payment.state = PaymentState.PENDING;
    payment.provider =
      this.provider.name === 'stone' ? PaymentProviderName.STONE : PaymentProviderName.MOCK;
    payment.provider_session_id = checkout.sessionId;
    payment.provider_metadata = (checkout.metadata as Record<string, unknown>) ?? {};
    payment.expires_at = checkout.expiresAt;
    em.persist(payment);

    return { payment, paymentUrl: checkout.paymentUrl };
  }

  /**
   * Apply a webhook event. Idempotent on `session_id` + `outcome`:
   *   - first time: transitions Payment + linked SaleOrder, returns `accepted`.
   *   - same outcome replay on terminal session: returns `replay` (200 to caller).
   *   - different outcome on terminal session: returns `terminal_mismatch` (410).
   *
   * Throws NotFoundException when the session is unknown.
   */
  async handleWebhookEvent(event: PaymentWebhookEvent): Promise<WebhookHandleResult> {
    if (!event.sessionId) throw new NotFoundException('Unknown payment session');

    return this.em.transactional(async (em) => {
      const payment = await em.findOne(
        Payment,
        { provider_session_id: event.sessionId },
        { populate: ['sale_order'], ...noTenantFilter() },
      );
      if (!payment) throw new NotFoundException('Unknown payment session');

      const targetState =
        event.outcome === 'success' ? PaymentState.SUCCEEDED : PaymentState.FAILED;
      const targetOrderState =
        event.outcome === 'success' ? SaleOrderState.CONFIRMED : SaleOrderState.CANCELLED;

      if (payment.state !== PaymentState.PENDING) {
        if (payment.state === targetState) {
          return { status: 'replay' as const, payment };
        }
        throw new GoneException('Payment session is already in a terminal state');
      }

      payment.state = targetState;
      if (event.reason) payment.error_message = event.reason;

      const order = payment.sale_order;
      order.state = targetOrderState;
      if (targetOrderState === SaleOrderState.CANCELLED) {
        order.cancelled_at = new Date();
        if (!order.cancellation_reason) {
          order.cancellation_reason =
            event.outcome === 'failure' ? 'payment_failed' : 'payment_cancelled';
        }
      }

      await em.flush();
      return { status: 'accepted' as const, payment };
    });
  }

  /** Cron-driven expiration. Returns the number of payments transitioned. */
  async expirePending(now: Date = new Date()): Promise<number> {
    return this.em.transactional(async (em) => {
      const payments = await em.find(
        Payment,
        { state: PaymentState.PENDING, expires_at: { $lt: now } },
        { populate: ['sale_order'], ...noTenantFilter() },
      );
      for (const p of payments) {
        p.state = PaymentState.EXPIRED;
        const order = p.sale_order;
        order.state = SaleOrderState.CANCELLED;
        order.cancelled_at = now;
        if (!order.cancellation_reason) order.cancellation_reason = 'payment_expired';
      }
      await em.flush();
      return payments.length;
    });
  }

  /** Public listing for `GET /sale-orders/:id/payments`. */
  async listPaymentsForOrder(
    tenantId: string,
    customerId: string,
    orderId: string,
  ): Promise<Payment[]> {
    const order = await this.em.findOne(
      SaleOrder,
      { id: orderId, tenant_id: tenantId },
      noTenantFilter(),
    );
    if (!order) throw new NotFoundException('Order not found');
    if (order.customer.id !== customerId) {
      throw new NotFoundException('Order not found');
    }
    return this.em.find(
      Payment,
      { sale_order: order.id, tenant_id: tenantId },
      { orderBy: { created_at: 'desc' }, ...noTenantFilter() },
    );
  }

  // Convenience: quietly used by tests
  async findBySession(sessionId: string): Promise<Payment | null> {
    return this.em.findOne(Payment, { provider_session_id: sessionId }, noTenantFilter());
  }

  // Reference helper for callers that need a User reference for the Payment.customer FK.
  resolveCustomerRef(em: EntityManager, customerId: string): User {
    return em.getReference(User, customerId);
  }
}
