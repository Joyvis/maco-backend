import { Logger } from '@nestjs/common';

import { SendMagicLinkInput } from '../message-provider.interface';

import { MockMessageProvider } from './mock-message.provider';

describe('MockMessageProvider', () => {
  let provider: MockMessageProvider;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    provider = new MockMessageProvider();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('logs the magic link details and resolves', async () => {
    const input: SendMagicLinkInput = {
      tenantId: 't-1',
      tenantSlug: 'salao-demo',
      phoneE164: '+5511912123434',
      magicUrl: 'http://localhost:3000/shop/salao-demo/auth/verify?token=abc',
      expiresAt: new Date('2026-05-30T12:00:00Z'),
    };

    await expect(provider.sendMagicLink(input)).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest mock.calls is typed as any[][]
    const logged = String(logSpy.mock.calls[0]?.[0] ?? '');
    expect(logged).toContain('salao-demo');
    expect(logged).toContain('+5511912123434');
    expect(logged).toContain('http://localhost:3000/shop/salao-demo/auth/verify?token=abc');
    expect(logged).toContain('2026-05-30T12:00:00.000Z');
  });

  it('exposes name="mock"', () => {
    expect(provider.name).toBe('mock');
  });
});
