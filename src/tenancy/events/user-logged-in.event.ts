import { randomUUID } from 'node:crypto';

import { BaseEvent } from '@shared/cqrs/base-event';

export class UserLoggedInEvent extends BaseEvent {
  readonly user_id: string;
  readonly ip_address: string;
  readonly user_agent: string;
  readonly logged_in_at: Date;

  constructor(
    tenant_id: string,
    user_id: string,
    ip_address: string,
    user_agent: string,
    logged_in_at: Date,
  ) {
    super(tenant_id, 'UserLogin', randomUUID());
    this.user_id = user_id;
    this.ip_address = ip_address;
    this.user_agent = user_agent;
    this.logged_in_at = logged_in_at;
  }
}
