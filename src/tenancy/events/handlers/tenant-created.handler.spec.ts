import { Logger } from '@nestjs/common';

import { TenantCreatedEvent } from '../tenant-created.event';

import { TenantCreatedHandler } from './tenant-created.handler';

describe('TenantCreatedHandler', () => {
  let handler: TenantCreatedHandler;

  beforeEach(() => {
    handler = new TenantCreatedHandler();
    jest
      .spyOn(handler as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep')
      .mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  // AC2
  it('handles TenantCreatedEvent and logs receipt', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const event = new TenantCreatedEvent('tenant-uuid', 'corr-uuid', 'Acme Corp');

    await handler.handle(event);

    expect(logSpy).toHaveBeenCalled();
    const logMessage = logSpy.mock.calls[0][0] as string;
    expect(logMessage).toContain('TenantCreatedEvent');
  });

  it('receives event with correct metadata fields', () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const event = new TenantCreatedEvent('tenant-uuid', 'corr-uuid', 'Acme Corp');

    expect(event.tenant_id).toBe('tenant-uuid');
    expect(event.source_command).toBe('CreateTenantCommand');
    expect(event.correlation_id).toBe('corr-uuid');
    expect(event.name).toBe('Acme Corp');
    expect(event.timestamp).toBeInstanceOf(Date);
  });
});
