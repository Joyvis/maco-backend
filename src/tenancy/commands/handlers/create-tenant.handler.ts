import { randomUUID } from 'crypto';

import { CommandHandler, EventBus } from '@nestjs/cqrs';
import { BaseCommandHandler } from '@shared/cqrs/base-command-handler';

import { TenantCreatedEvent } from '../../events/tenant-created.event';
import { CreateTenantCommand } from '../create-tenant.command';

@CommandHandler(CreateTenantCommand)
export class CreateTenantHandler extends BaseCommandHandler<CreateTenantCommand> {
  constructor(private readonly eventBus: EventBus) {
    super();
  }

  execute(command: CreateTenantCommand): Promise<void> {
    const event = new TenantCreatedEvent(command.tenant_id, randomUUID(), command.name);
    this.eventBus.publish(event);
    return Promise.resolve();
  }
}
