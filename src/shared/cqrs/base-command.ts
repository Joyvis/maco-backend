export abstract class BaseCommand {
  readonly tenant_id: string;
  readonly user_id: string;
  readonly timestamp: Date;

  constructor(tenant_id: string, user_id: string) {
    if (!tenant_id) throw new Error("BaseCommand: tenant_id is required");
    if (!user_id) throw new Error("BaseCommand: user_id is required");
    this.tenant_id = tenant_id;
    this.user_id = user_id;
    this.timestamp = new Date();
  }
}
