import { BaseCommand } from '@shared/cqrs/base-command';

import { AccountType, SubscriptionType } from '../entities/tenant.entity';

interface RegisterTenantParams {
  name: string;
  email: string;
  password_hash: string;
  full_name: string;
  account_type: AccountType;
  parent_tenant_id?: string;
  plan_id: string;
  subscription_type: SubscriptionType;
  bypass_payment?: boolean;
}

export class RegisterTenantCommand extends BaseCommand {
  readonly name: string;
  readonly email: string;
  readonly password_hash: string;
  readonly full_name: string;
  readonly account_type: AccountType;
  readonly parent_tenant_id?: string;
  readonly plan_id: string;
  readonly subscription_type: SubscriptionType;
  readonly bypass_payment: boolean;

  constructor(tenant_id: string, user_id: string, params: RegisterTenantParams) {
    super(tenant_id, user_id);
    this.name = params.name;
    this.email = params.email;
    this.password_hash = params.password_hash;
    this.full_name = params.full_name;
    this.account_type = params.account_type;
    this.parent_tenant_id = params.parent_tenant_id;
    this.plan_id = params.plan_id;
    this.subscription_type = params.subscription_type;
    this.bypass_payment = params.bypass_payment ?? false;
  }
}
