import { CommandHandler, EventBus } from "@nestjs/cqrs";
import { randomUUID } from "crypto";
import { BaseCommandHandler } from "@shared/cqrs/base-command-handler";
import { CreateTenantCommand } from "../create-tenant.command";
import { TenantCreatedEvent } from "../../events/tenant-created.event";

@CommandHandler(CreateTenantCommand)
export class CreateTenantHandler extends BaseCommandHandler<CreateTenantCommand> {
  constructor(private readonly eventBus: EventBus) {
    super();
  }

  execute(command: CreateTenantCommand): Promise<void> {
    const event = new TenantCreatedEvent(
      command.tenant_id,
      randomUUID(),
      command.name,
    );
    this.eventBus.publish(event);
    return Promise.resolve();
  }
}
