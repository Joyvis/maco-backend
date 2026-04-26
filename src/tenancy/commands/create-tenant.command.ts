import { BaseCommand } from "@shared/cqrs/base-command";

export class CreateTenantCommand extends BaseCommand {
  readonly name: string;

  constructor(tenant_id: string, user_id: string, name: string) {
    super(tenant_id, user_id);
    this.name = name;
  }
}
