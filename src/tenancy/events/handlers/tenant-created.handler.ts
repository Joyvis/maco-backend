import { EventsHandler } from '@nestjs/cqrs';
import { BaseEventHandler } from '@shared/cqrs/base-event-handler';

import { TenantCreatedEvent } from '../tenant-created.event';

@EventsHandler(TenantCreatedEvent)
export class TenantCreatedHandler extends BaseEventHandler<TenantCreatedEvent> {
  process(event: TenantCreatedEvent): Promise<void> {
    this.logger.log(`TenantCreatedEvent received: tenant=${event.tenant_id}, name=${event.name}`, {
      correlation_id: event.correlation_id,
    });
    return Promise.resolve();
  }
}
