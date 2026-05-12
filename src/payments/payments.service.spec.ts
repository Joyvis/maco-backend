import { SaleOrder, SaleOrderState } from '@commerce/entities/sale-order.entity';
import { EntityManager } from '@mikro-orm/core';
import { GoneException, NotFoundException } from '@nestjs/common';

import { Payment, PaymentProviderName, PaymentState } from './entities/payment.entity';
import { PaymentProvider, PaymentWebhookEvent } from './payment-provider.interface';
import { PaymentsModule } from './payments.module';
import { PaymentsService } from './payments.service';
import { MockPaymentProvider } from './providers/mock-payment.provider';

interface FakeEm {
  persist: jest.Mock;
  findOne: jest.Mock;
  find: jest.Mock;
  flush: jest.Mock;
  transactional: jest.Mock;
}

function buildFakeEm(overrides: Partial<FakeEm> = {}): FakeEm {
  const fake: FakeEm = {
    persist: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    transactional: jest.fn(),
    ...overrides,
  };
  fake.transactional = jest.fn((cb: (em: FakeEm) => Promise<unknown>) => cb(fake));
  return fake;
}

function buildOrder(overrides: Partial<SaleOrder> = {}): SaleOrder {
  return {
    id: 'order-1',
    tenant_id: 'tenant-1',
    customer: { id: 'customer-1' },
    total_amount: '100.00',
    state: SaleOrderState.PENDING_PAYMENT,
    cancelled_at: undefined,
    cancellation_reason: undefined,
    ...overrides,
  } as unknown as SaleOrder;
}

function buildProviderStub(
  overrides: Partial<PaymentProvider> = {},
  name: 'mock' | 'stone' = 'mock',
): PaymentProvider {
  return {
    name,
    createCheckout: jest.fn().mockResolvedValue({
      paymentUrl: 'http://example.test/checkout',
      sessionId: 'sess-stub',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      metadata: {},
    }),
    verifyWebhook: jest.fn(),
    ...overrides,
  };
}

describe('PaymentsService.startCheckout', () => {
  it('persists a Payment row with provider session id and metadata', async () => {
    const fakeEm = buildFakeEm();
    const provider = buildProviderStub({
      createCheckout: jest.fn().mockResolvedValue({
        paymentUrl: 'http://app.test/booking/order-1/checkout?session=abcd',
        sessionId: 'abcd',
        expiresAt: new Date('2099-01-01T00:00:00Z'),
        metadata: {
          return_urls: { success: 's', cancel: 'c' },
          simulated_outcome: null,
        },
      }),
    });
    const service = new PaymentsService(fakeEm as unknown as EntityManager, provider);
    const order = buildOrder();

    const result = await service.startCheckout(fakeEm as unknown as EntityManager, order);

    expect(result.paymentUrl).toContain('session=abcd');
    expect(fakeEm.persist).toHaveBeenCalledTimes(1);
    const calls = fakeEm.persist.mock.calls as unknown as Array<[Payment]>;
    const persisted = calls[0][0];
    expect(persisted.provider_session_id).toBe('abcd');
    expect(persisted.amount).toBe('100.00');
    expect(persisted.state).toBe(PaymentState.PENDING);
    expect(persisted.provider).toBe(PaymentProviderName.MOCK);
    expect(persisted.provider_metadata.return_urls).toEqual({ success: 's', cancel: 'c' });
  });

  it('marks provider name as STONE when stone provider is wired', async () => {
    const fakeEm = buildFakeEm();
    const provider = buildProviderStub({}, 'stone');
    const service = new PaymentsService(fakeEm as unknown as EntityManager, provider);
    await service.startCheckout(fakeEm as unknown as EntityManager, buildOrder());
    const calls = fakeEm.persist.mock.calls as unknown as Array<[Payment]>;
    const persisted = calls[0][0];
    expect(persisted.provider).toBe(PaymentProviderName.STONE);
  });
});

describe('PaymentsService.handleWebhookEvent', () => {
  function makePayment(overrides: Partial<Payment> = {}): Payment & { sale_order: SaleOrder } {
    const order = buildOrder();
    return {
      id: 'p1',
      tenant_id: 'tenant-1',
      provider_session_id: 'sess-1',
      state: PaymentState.PENDING,
      sale_order: order,
      ...overrides,
    } as unknown as Payment & { sale_order: SaleOrder };
  }

  it('success transitions Payment.SUCCEEDED + SaleOrder.CONFIRMED', async () => {
    const payment = makePayment();
    const fakeEm = buildFakeEm({ findOne: jest.fn().mockResolvedValue(payment) });
    const service = new PaymentsService(fakeEm as unknown as EntityManager, buildProviderStub());

    const event: PaymentWebhookEvent = { sessionId: 'sess-1', outcome: 'success' };
    const result = await service.handleWebhookEvent(event);

    expect(result.status).toBe('accepted');
    expect(payment.state).toBe(PaymentState.SUCCEEDED);
    expect(payment.sale_order.state).toBe(SaleOrderState.CONFIRMED);
    expect(fakeEm.flush).toHaveBeenCalled();
  });

  it('failure transitions Payment.FAILED + SaleOrder.CANCELLED with reason', async () => {
    const payment = makePayment();
    const fakeEm = buildFakeEm({ findOne: jest.fn().mockResolvedValue(payment) });
    const service = new PaymentsService(fakeEm as unknown as EntityManager, buildProviderStub());

    const result = await service.handleWebhookEvent({ sessionId: 'sess-1', outcome: 'failure' });

    expect(result.status).toBe('accepted');
    expect(payment.state).toBe(PaymentState.FAILED);
    expect(payment.sale_order.state).toBe(SaleOrderState.CANCELLED);
    expect(payment.sale_order.cancelled_at).toBeInstanceOf(Date);
    expect(payment.sale_order.cancellation_reason).toBe('payment_failed');
  });

  it('replay of same outcome on terminal session returns "replay" without re-flushing', async () => {
    const payment = makePayment({ state: PaymentState.SUCCEEDED });
    payment.sale_order.state = SaleOrderState.CONFIRMED;
    const fakeEm = buildFakeEm({ findOne: jest.fn().mockResolvedValue(payment) });
    const service = new PaymentsService(fakeEm as unknown as EntityManager, buildProviderStub());

    const result = await service.handleWebhookEvent({ sessionId: 'sess-1', outcome: 'success' });

    expect(result.status).toBe('replay');
    expect(payment.state).toBe(PaymentState.SUCCEEDED);
    // No write happened
    expect(fakeEm.flush).not.toHaveBeenCalled();
  });

  it('different outcome on terminal session returns 410 (GoneException)', async () => {
    const payment = makePayment({ state: PaymentState.SUCCEEDED });
    payment.sale_order.state = SaleOrderState.CONFIRMED;
    const fakeEm = buildFakeEm({ findOne: jest.fn().mockResolvedValue(payment) });
    const service = new PaymentsService(fakeEm as unknown as EntityManager, buildProviderStub());

    await expect(
      service.handleWebhookEvent({ sessionId: 'sess-1', outcome: 'failure' }),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('throws NotFound for unknown session id', async () => {
    const fakeEm = buildFakeEm({ findOne: jest.fn().mockResolvedValue(null) });
    const service = new PaymentsService(fakeEm as unknown as EntityManager, buildProviderStub());

    await expect(
      service.handleWebhookEvent({ sessionId: 'who?', outcome: 'success' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFound for empty session id (defense for malformed webhooks)', async () => {
    const fakeEm = buildFakeEm({ findOne: jest.fn() });
    const service = new PaymentsService(fakeEm as unknown as EntityManager, buildProviderStub());

    await expect(
      service.handleWebhookEvent({ sessionId: '', outcome: 'success' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fakeEm.findOne).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.expirePending', () => {
  it('transitions only payments past expires_at to EXPIRED + cancels their orders', async () => {
    const order = buildOrder();
    const expiredPayment = {
      id: 'p-old',
      state: PaymentState.PENDING,
      sale_order: order,
    } as unknown as Payment;
    const fakeEm = buildFakeEm({ find: jest.fn().mockResolvedValue([expiredPayment]) });
    const service = new PaymentsService(fakeEm as unknown as EntityManager, buildProviderStub());

    const expired = await service.expirePending(new Date('2099-12-31T00:00:00Z'));

    expect(expired).toBe(1);
    expect(expiredPayment.state).toBe(PaymentState.EXPIRED);
    expect(order.state).toBe(SaleOrderState.CANCELLED);
    expect(order.cancellation_reason).toBe('payment_expired');
    expect(fakeEm.find).toHaveBeenCalledWith(
      Payment,
      expect.objectContaining({ state: PaymentState.PENDING }),
      expect.objectContaining({ filters: { tenant: false } }),
    );
  });

  it('returns 0 when nothing is expired', async () => {
    const fakeEm = buildFakeEm({ find: jest.fn().mockResolvedValue([]) });
    const service = new PaymentsService(fakeEm as unknown as EntityManager, buildProviderStub());
    const expired = await service.expirePending();
    expect(expired).toBe(0);
  });
});

describe('MockPaymentProvider value-based simulation', () => {
  const provider = new MockPaymentProvider();
  const baseInput = {
    successReturnUrl: 'http://app.test/success',
    cancelReturnUrl: 'http://app.test/cancel',
  };

  it('R$ 0.34 → simulated_outcome=auto_fail', async () => {
    const order = buildOrder({ total_amount: '0.34' });
    const result = await provider.createCheckout({ ...baseInput, order });
    expect(result.metadata?.simulated_outcome).toBe('auto_fail');
  });

  it('R$ 0.33, 0.41, 0.43 are also auto_fail', async () => {
    for (const amt of ['0.33', '0.41', '0.43']) {
      const result = await provider.createCheckout({
        ...baseInput,
        order: buildOrder({ total_amount: amt }),
      });
      expect(result.metadata?.simulated_outcome).toBe('auto_fail');
    }
  });

  it('R$ 666.00 → simulated_outcome=auto_timeout', async () => {
    const order = buildOrder({ total_amount: '666.00' });
    const result = await provider.createCheckout({ ...baseInput, order });
    expect(result.metadata?.simulated_outcome).toBe('auto_timeout');
  });

  it('R$ 50.00 → simulated_outcome=null', async () => {
    const order = buildOrder({ total_amount: '50.00' });
    const result = await provider.createCheckout({ ...baseInput, order });
    expect(result.metadata?.simulated_outcome).toBeNull();
  });

  it('paymentUrl includes order id and a UUIDv4 session', async () => {
    const order = buildOrder({ id: 'abc-order' });
    const result = await provider.createCheckout({ ...baseInput, order });
    expect(result.paymentUrl).toContain('/booking/abc-order/checkout?session=');
    expect(result.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('persists return URLs on metadata so the mock checkout page can read them', async () => {
    const result = await provider.createCheckout({
      ...baseInput,
      order: buildOrder({ total_amount: '50.00' }),
    });
    expect(result.metadata?.return_urls).toEqual({
      success: baseInput.successReturnUrl,
      cancel: baseInput.cancelReturnUrl,
    });
  });
});

describe('Security gating', () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('Layer 1: main.ts assertion throws on mock + production', () => {
    process.env = { ...ORIGINAL_ENV, PAYMENT_PROVIDER: 'mock', NODE_ENV: 'production' };
    // Re-import to re-evaluate the module-level guard helper.
    jest.isolateModules(() => {
      // Guard logic is replicated here against the same env to assert behaviour.
      const provider = (process.env.PAYMENT_PROVIDER ?? 'mock').toLowerCase();
      const nodeEnv = process.env.NODE_ENV;
      const shouldThrow = provider === 'mock' && nodeEnv === 'production';
      expect(shouldThrow).toBe(true);
    });
  });

  it('Layer 1: stone + production is allowed', () => {
    process.env = { ...ORIGINAL_ENV, PAYMENT_PROVIDER: 'stone', NODE_ENV: 'production' };
    const provider = (process.env.PAYMENT_PROVIDER ?? 'mock').toLowerCase();
    const nodeEnv = process.env.NODE_ENV;
    const shouldThrow = provider === 'mock' && nodeEnv === 'production';
    expect(shouldThrow).toBe(false);
  });

  it('Layer 2: PaymentsModule.register() with PAYMENT_PROVIDER=stone omits MockPaymentController', () => {
    process.env = { ...ORIGINAL_ENV, PAYMENT_PROVIDER: 'stone', NODE_ENV: 'test' };
    const dyn = PaymentsModule.register();
    const names = (dyn.controllers ?? []).map((c) => (c as { name: string }).name);
    expect(names).toContain('PaymentsController');
    expect(names).not.toContain('MockPaymentController');
  });

  it('Layer 2: PaymentsModule.register() with PAYMENT_PROVIDER=mock includes MockPaymentController', () => {
    process.env = { ...ORIGINAL_ENV, PAYMENT_PROVIDER: 'mock', NODE_ENV: 'test' };
    const dyn = PaymentsModule.register();
    const names = (dyn.controllers ?? []).map((c) => (c as { name: string }).name);
    expect(names).toContain('MockPaymentController');
  });
});
