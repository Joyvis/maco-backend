import { createHmac } from 'crypto';

import { CommandBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';

import { StripeWebhookController } from './stripe-webhook.controller';
import { TenancyService } from './tenancy.service';

function makeStripeHeader(secret: string, payload: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sig = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

describe('StripeWebhookController', () => {
  let controller: StripeWebhookController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeWebhookController],
      providers: [TenancyService, { provide: CommandBus, useValue: { execute: jest.fn() } }],
    }).compile();

    controller = module.get<StripeWebhookController>(StripeWebhookController);
    process.env['STRIPE_WEBHOOK_SECRET'] = 'test-secret';
  });

  afterEach(() => {
    delete process.env['STRIPE_WEBHOOK_SECRET'];
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('throws BadRequestException when Stripe-Signature is missing', async () => {
    await expect(
      controller.handleStripeWebhook({ rawBody: Buffer.from('{}') } as never, undefined, {}),
    ).rejects.toThrow('Missing Stripe signature');
  });

  it('throws BadRequestException when signature is invalid', async () => {
    await expect(
      controller.handleStripeWebhook({ rawBody: Buffer.from('{}') } as never, 'invalid-sig', {}),
    ).rejects.toThrow('Invalid Stripe signature');
  });

  it('returns { received: true } for valid signature and non-payment event', async () => {
    const payload = JSON.stringify({ type: 'other.event', data: {} });
    const sig = makeStripeHeader('test-secret', payload);

    const result = await controller.handleStripeWebhook(
      { rawBody: Buffer.from(payload) } as never,
      sig,
      { type: 'other.event', data: {} },
    );

    expect(result).toEqual({ received: true });
  });
});
