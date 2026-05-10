import { ForbiddenException } from '@nestjs/common';

import { MockPaymentController } from './mock-payment.controller';
import { PaymentProvider } from './payment-provider.interface';
import { PaymentsService } from './payments.service';

describe('MockPaymentController in-handler guard (Layer 3)', () => {
  const ORIGINAL_ENV = process.env;
  let controller: MockPaymentController;
  let provider: PaymentProvider;
  let paymentsService: PaymentsService;

  beforeEach(() => {
    provider = {
      name: 'mock',
      createCheckout: jest.fn(),
      verifyWebhook: jest.fn().mockResolvedValue({ sessionId: 's', outcome: 'success' }),
    };
    paymentsService = {
      handleWebhookEvent: jest.fn().mockResolvedValue({ status: 'accepted' }),
      expirePending: jest.fn().mockResolvedValue(0),
    } as unknown as PaymentsService;
    controller = new MockPaymentController(paymentsService, provider);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('rejects with 403 when env is not mock', async () => {
    process.env = { ...ORIGINAL_ENV, PAYMENT_PROVIDER: 'stone' };
    const fakeReq = { headers: {}, body: {} };
    await expect(
      controller.handleMockWebhook(
        { session_id: 's', outcome: 'success' },
        fakeReq as unknown as Parameters<typeof controller.handleMockWebhook>[1],
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts when PAYMENT_PROVIDER=mock', async () => {
    process.env = { ...ORIGINAL_ENV, PAYMENT_PROVIDER: 'mock' };
    const fakeReq = { headers: {}, body: { session_id: 's', outcome: 'success' } };
    const result = await controller.handleMockWebhook(
      { session_id: 's', outcome: 'success' },
      fakeReq as unknown as Parameters<typeof controller.handleMockWebhook>[1],
    );
    expect(result.status).toBe('accepted');
  });

  it('test endpoint is rejected outside NODE_ENV=test', async () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'development' };
    await expect(controller.runExpiration()).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('test endpoint runs the cron under NODE_ENV=test', async () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test' };
    const result = await controller.runExpiration();
    expect(result).toEqual({ expired: 0 });
    const calls = (paymentsService.expirePending as unknown as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
  });
});
