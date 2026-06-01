import { randomBytes } from 'crypto';

import { EntityManager, EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { ConflictException } from '@nestjs/common';
import { CommandHandler, EventBus } from '@nestjs/cqrs';
import { BaseCommandHandler } from '@shared/cqrs/base-command-handler';
import * as bcrypt from 'bcrypt';
import { uuidv7 } from 'uuidv7';

import { CreateUserResponseDto } from '../../dto/create-user-response.dto';
import { Role } from '../../entities/role.entity';
import { UserRole } from '../../entities/user-role.entity';
import { User, UserState } from '../../entities/user.entity';
import { UserCreatedEvent } from '../../events/user-created.event';
import { CreateUserCommand } from '../create-user.command';

const BCRYPT_ROUNDS = 10;
const TEMP_PASSWORD_BYTES = 16;

@CommandHandler(CreateUserCommand)
export class CreateUserHandler extends BaseCommandHandler<
  CreateUserCommand,
  CreateUserResponseDto
> {
  constructor(
    private readonly em: EntityManager,
    @InjectRepository(User) private readonly userRepo: EntityRepository<User>,
    @InjectRepository(Role) private readonly roleRepo: EntityRepository<Role>,
    private readonly eventBus: EventBus,
  ) {
    super();
  }

  async execute(command: CreateUserCommand): Promise<CreateUserResponseDto> {
    const existing = await this.userRepo.findOne(
      { email: command.email, tenant_id: command.tenant_id },
      { filters: false },
    );
    if (existing) {
      throw new ConflictException(`User with email '${command.email}' already exists`);
    }

    const tempPassword = randomBytes(TEMP_PASSWORD_BYTES).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    const newUserId = uuidv7();

    const user = this.em.create(User, {
      id: newUserId,
      tenant_id: command.tenant_id,
      email: command.email,
      password_hash: passwordHash,
      full_name: command.full_name,
      phone: command.phone,
      state: UserState.ACTIVE,
    });

    const userRoles: UserRole[] = [];
    const roleNames: string[] = [];

    if (command.initial_roles.length > 0) {
      const roles = await this.roleRepo.find(
        { name: { $in: command.initial_roles }, tenant_id: command.tenant_id },
        { filters: false },
      );
      for (const role of roles) {
        userRoles.push(this.em.create(UserRole, { user, role }));
        roleNames.push(role.name);
      }
    }

    await this.em.persistAndFlush([user, ...userRoles]);

    this.eventBus.publish(
      new UserCreatedEvent(
        command.tenant_id,
        command.correlation_id,
        newUserId,
        command.email,
        command.full_name,
        roleNames,
      ),
    );

    return {
      id: user.id,
      tenant_id: user.tenant_id,
      email: user.email,
      full_name: user.full_name ?? '',
      phone: user.phone ?? null,
      state: 'active',
      roles: roleNames,
      created_at: user.created_at.toISOString(),
    };
  }
}
