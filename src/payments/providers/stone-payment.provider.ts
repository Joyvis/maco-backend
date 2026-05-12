import { Injectable, NotImplementedException } from '@nestjs/common';

import {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProvider,
  PaymentWebhookEvent,
  RawRequest,
} from '../payment-provider.interface';

/**
 * Stone OpenBank "Link de Pagamento" — STUB for the next phase.
 *
 * createCheckout will call:
 *   POST https://sandbox-api.openbank.stone.com.br/api/v1/payment_links/orders
 *   Headers: Authorization: Bearer ${STONE_API_KEY}
 *            X-Stone-Account-Id: ${STONE_ACCOUNT_ID}
 *   Body shape (abridged):
 *     {
 *       items: [...],
 *       customer: { name, email },
 *       checkout: { success_url, cancel_url },
 *       expiration: { value: 15, unit: 'minutes' }
 *     }
 *
 * verifyWebhook will validate the HMAC signature header against
 * STONE_WEBHOOK_SECRET (Stone uses the raw request body) and map Stone events
 * (`order.paid`, `order.payment_failed`, `order.expired`) to internal
 * success | failure outcomes.
 *
 * When this stub is filled in, the only place that should change is this file
 * plus the env wiring. The rest of the payments module is provider-agnostic.
 */
@Injectable()
export class StonePaymentProvider implements PaymentProvider {
  readonly name = 'stone' as const;

  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    void input;
    return Promise.reject(
      new NotImplementedException(
        'StonePaymentProvider.createCheckout is not implemented yet — see comments for the real Stone Link de Pagamento contract.',
      ),
    );
  }

  verifyWebhook(req: RawRequest): Promise<PaymentWebhookEvent> {
    void req;
    return Promise.reject(
      new NotImplementedException(
        'StonePaymentProvider.verifyWebhook is not implemented yet — HMAC signature verification against STONE_WEBHOOK_SECRET will live here.',
      ),
    );
  }
}
