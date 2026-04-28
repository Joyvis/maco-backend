import { BaseEvent } from '@shared/cqrs/base-event';

import { CreateUserCommand } from '../commands/create-user.command';

export class UserCreatedEvent extends BaseEvent {
  readonly user_id: string;
  readonly email: string;
  readonly full_name: string;
  readonly roles: string[];

  constructor(
    tenant_id: string,
    correlation_id: string,
    user_id: string,
    email: string,
    full_name: string,
    roles: string[],
  ) {
    super(tenant_id, CreateUserCommand.name, correlation_id);
    this.user_id = user_id;
    this.email = email;
    this.full_name = full_name;
    this.roles = roles;
  }
}
