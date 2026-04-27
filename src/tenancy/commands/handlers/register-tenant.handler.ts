import { EntityManager, EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { ConflictException } from '@nestjs/common';
import { CommandHandler, EventBus } from '@nestjs/cqrs';
import { BaseCommandHandler } from '@shared/cqrs/base-command-handler';

import { SignUpResponseDto } from '../../dto/sign-up-response.dto';
import { Role } from '../../entities/role.entity';
import { Tenant, TenantStatus, SubscriptionType } from '../../entities/tenant.entity';
import { UserRole } from '../../entities/user-role.entity';
import { UserState, User } from '../../entities/user.entity';
import { TenantRegisteredEvent } from '../../events/tenant-registered.event';
import { RegisterTenantCommand } from '../register-tenant.command';

const TRIAL_DAYS = 14;
const DEFAULT_SYSTEM_ROLES = ['owner', 'ta', 'staff', 'customer'] as const;

@CommandHandler(RegisterTenantCommand)
export class RegisterTenantHandler extends BaseCommandHandler<
  RegisterTenantCommand,
  SignUpResponseDto
> {
  constructor(
    private readonly em: EntityManager,
    @InjectRepository(Tenant) private readonly tenantRepo: EntityRepository<Tenant>,
    private readonly eventBus: EventBus,
  ) {
    super();
  }

  async execute(command: RegisterTenantCommand): Promise<SignUpResponseDto> {
    const existing = await this.tenantRepo.findOne(
      { name: command.name, parent_tenant_id: command.parent_tenant_id ?? null },
      { filters: false },
    );
    if (existing) {
      throw new ConflictException(`Tenant name '${command.name}' already exists`);
    }

    const isTrial = command.subscription_type === SubscriptionType.FREE_TRIAL;

    if (!isTrial && !command.bypass_payment) {
      const checkoutUrl = `https://checkout.stripe.com/pay/${command.tenant_id}`;
      return {
        tenant_id: command.tenant_id,
        status: TenantStatus.PENDING_PAYMENT,
        checkout_url: checkoutUrl,
      };
    }

    const status = command.bypass_payment && !isTrial ? TenantStatus.ACTIVE : TenantStatus.TRIAL;
    const trial_ends_at = isTrial
      ? new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000)
      : undefined;

    const tenant = this.em.create(Tenant, {
      id: command.tenant_id,
      name: command.name,
      account_type: command.account_type,
      parent_tenant_id: command.parent_tenant_id,
      status,
      plan_id: command.plan_id,
      subscription_type: command.subscription_type,
      trial_ends_at,
    });

    const roles = DEFAULT_SYSTEM_ROLES.map((name) =>
      this.em.create(Role, { tenant_id: command.tenant_id, name, is_system: true }),
    );

    const user = this.em.create(User, {
      id: command.user_id,
      tenant_id: command.tenant_id,
      email: command.email,
      password_hash: command.password_hash,
      full_name: command.full_name,
      state: UserState.ACTIVE,
    });

    const ownerRole = roles.find((r) => r.name === 'owner')!;
    const userRole = this.em.create(UserRole, { user, role: ownerRole });

    await this.em.persistAndFlush([tenant, ...roles, user, userRole]);

    this.eventBus.publish(
      new TenantRegisteredEvent(
        command.tenant_id,
        command.correlation_id,
        command.account_type,
        command.user_id,
        tenant.created_at,
        command.parent_tenant_id,
      ),
    );

    return { tenant_id: command.tenant_id, status, trial_ends_at };
  }
}
