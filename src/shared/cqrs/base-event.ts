export abstract class BaseEvent {
  readonly tenant_id: string;
  readonly source_command: string;
  readonly correlation_id: string;
  readonly timestamp: Date;

  constructor(tenant_id: string, source_command: string, correlation_id: string) {
    if (!tenant_id) throw new Error('BaseEvent: tenant_id is required');
    if (!source_command) throw new Error('BaseEvent: source_command is required');
    if (!correlation_id) throw new Error('BaseEvent: correlation_id is required');
    this.tenant_id = tenant_id;
    this.source_command = source_command;
    this.correlation_id = correlation_id;
    this.timestamp = new Date();
  }
}
