import { BaseEvent } from "@shared/cqrs/base-event";

export class TenantCreatedEvent extends BaseEvent {
  readonly name: string;

  constructor(tenant_id: string, correlation_id: string, name: string) {
    super(tenant_id, "CreateTenantCommand", correlation_id);
    this.name = name;
  }
}
