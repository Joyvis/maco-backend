import { EventBus } from '@nestjs/cqrs';

import { TenantCreatedEvent } from '../../events/tenant-created.event';
import { CreateTenantCommand } from '../create-tenant.command';

import { CreateTenantHandler } from './create-tenant.handler';

describe('CreateTenantHandler', () => {
  let handler: CreateTenantHandler;
  let eventBus: jest.Mocked<EventBus>;

  beforeEach(() => {
    eventBus = { publish: jest.fn() } as unknown as jest.Mocked<EventBus>;
    handler = new CreateTenantHandler(eventBus);
  });

  // AC1
  it('executes with all command metadata and publishes TenantCreatedEvent', async () => {
    const command = new CreateTenantCommand('tenant-uuid', 'user-uuid', 'Acme Corp');

    await handler.execute(command);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    const publishedEvent = eventBus.publish.mock.calls[0][0] as TenantCreatedEvent;
    expect(publishedEvent).toBeInstanceOf(TenantCreatedEvent);
    expect(publishedEvent.tenant_id).toBe('tenant-uuid');
    expect(publishedEvent.source_command).toBe('CreateTenantCommand');
    expect(publishedEvent.correlation_id).toBe(command.correlation_id);
    expect(publishedEvent.name).toBe('Acme Corp');
    expect(publishedEvent.timestamp).toBeInstanceOf(Date);
  });
});
