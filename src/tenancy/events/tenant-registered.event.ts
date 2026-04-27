import { BaseEvent } from '@shared/cqrs/base-event';

import { RegisterTenantCommand } from '../commands/register-tenant.command';
import { AccountType } from '../entities/tenant.entity';

export class TenantRegisteredEvent extends BaseEvent {
  readonly account_type: AccountType;
  readonly parent_tenant_id?: string;
  readonly owner_user_id: string;
  readonly created_at: Date;

  constructor(
    tenant_id: string,
    correlation_id: string,
    account_type: AccountType,
    owner_user_id: string,
    created_at: Date,
    parent_tenant_id?: string,
  ) {
    super(tenant_id, RegisterTenantCommand.name, correlation_id);
    this.account_type = account_type;
    this.parent_tenant_id = parent_tenant_id;
    this.owner_user_id = owner_user_id;
    this.created_at = created_at;
  }
}
