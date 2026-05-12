import { SaleOrder } from '@commerce/entities/sale-order.entity';

export type PaymentWebhookOutcome = 'success' | 'failure';

export interface PaymentWebhookEvent {
  /** Provider's session id (mock: UUIDv4; Stone: order id). */
  sessionId: string;
  outcome: PaymentWebhookOutcome;
  /** Optional human-readable reason populated by the provider. */
  reason?: string;
  /** Raw provider payload — handy for diagnostics; never reflected back to the customer. */
  raw?: unknown;
}

export interface CreateCheckoutInput {
  order: SaleOrder;
  /** Where the customer is redirected after a successful payment. */
  successReturnUrl: string;
  /** Where the customer is redirected after an explicit cancel/failure. */
  cancelReturnUrl: string;
}

export interface CreateCheckoutResult {
  paymentUrl: string;
  sessionId: string;
  expiresAt: Date;
  /** Optional metadata to persist on the Payment row (e.g., simulated_outcome, return URLs). */
  metadata?: Record<string, unknown>;
}

/**
 * Loose Express request shape — full type imported in handler files only.
 * We keep the interface decoupled so providers don't drag the whole framework in.
 */
export interface RawRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  rawBody?: Buffer;
}

export interface PaymentProvider {
  readonly name: 'mock' | 'stone';
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  verifyWebhook(req: RawRequest): Promise<PaymentWebhookEvent>;
}

/** DI token for the active provider (resolved by env). */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
