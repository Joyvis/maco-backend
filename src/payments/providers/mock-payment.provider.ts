import { randomUUID } from 'crypto';

import { Injectable } from '@nestjs/common';

import {
  CreateCheckoutInput,
  CreateCheckoutResult,
  PaymentProvider,
  PaymentWebhookEvent,
  RawRequest,
} from '../payment-provider.interface';

import { getSimulatedOutcome } from './mock-payment.constants';

const FRONTEND_URL_FALLBACK = 'http://localhost:3000';

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const sessionId = randomUUID();
    const ttlMinutes = readTtlMinutes();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    const frontendUrl = (process.env.FRONTEND_URL ?? FRONTEND_URL_FALLBACK).replace(/\/$/, '');
    const paymentUrl = `${frontendUrl}/booking/${input.order.id}/checkout?session=${sessionId}`;

    const simulatedOutcome = getSimulatedOutcome(input.order.total_amount);

    return Promise.resolve({
      paymentUrl,
      sessionId,
      expiresAt,
      metadata: {
        return_urls: {
          success: input.successReturnUrl,
          cancel: input.cancelReturnUrl,
        },
        simulated_outcome: simulatedOutcome,
      },
    });
  }

  async verifyWebhook(req: RawRequest): Promise<PaymentWebhookEvent> {
    // Mock provider does not sign requests — the route is mock-only and gated
    // by env (DynamicModule + handler guard). The body is taken at face value;
    // the service-layer matches strictly on `provider_session_id` so an attacker
    // would still need a valid UUID.
    const body = (req.body ?? {}) as { session_id?: unknown; outcome?: unknown };
    const sessionId = typeof body.session_id === 'string' ? body.session_id : '';
    const outcome = body.outcome === 'success' ? 'success' : 'failure';

    return Promise.resolve({
      sessionId,
      outcome,
      raw: body,
    });
  }
}

function readTtlMinutes(): number {
  const raw = process.env.PAYMENT_EXPIRATION_MINUTES;
  if (!raw) return 15;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 15;
  return n;
}
