import { BaseEvent } from '@shared/cqrs/base-event';

import { CreateTenantCommand } from '../commands/create-tenant.command';

export class TenantCreatedEvent extends BaseEvent {
  readonly name: string;

  constructor(tenant_id: string, correlation_id: string, name: string) {
    super(tenant_id, CreateTenantCommand.name, correlation_id);
    this.name = name;
  }
}
