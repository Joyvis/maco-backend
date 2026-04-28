import { BaseCommand } from '@shared/cqrs/base-command';

import { UserRoleType } from '../dto/create-user.dto';

export class CreateUserCommand extends BaseCommand {
  readonly email: string;
  readonly full_name: string;
  readonly phone?: string;
  readonly initial_roles: UserRoleType[];

  constructor(
    tenant_id: string,
    user_id: string,
    params: {
      email: string;
      full_name: string;
      phone?: string;
      initial_roles: UserRoleType[];
    },
  ) {
    super(tenant_id, user_id);
    this.email = params.email;
    this.full_name = params.full_name;
    this.phone = params.phone;
    this.initial_roles = params.initial_roles;
  }
}
