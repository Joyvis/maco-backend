import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import * as bcrypt from 'bcrypt';
import { uuidv7 } from 'uuidv7';

import { RegisterTenantCommand } from './commands/register-tenant.command';
import { AdminCreateTenantDto } from './dto/admin-create-tenant.dto';
import { SignUpResponseDto } from './dto/sign-up-response.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { AccountType, SubscriptionType } from './entities/tenant.entity';

@Injectable()
export class TenancyService {
  constructor(private readonly commandBus: CommandBus) {}

  async registerTenant(dto: SignUpDto): Promise<SignUpResponseDto> {
    const tenantId = uuidv7();
    const ownerId = uuidv7();
    const passwordHash = await bcrypt.hash(dto.password, 10);

    return this.commandBus.execute<RegisterTenantCommand, SignUpResponseDto>(
      new RegisterTenantCommand(tenantId, ownerId, {
        name: dto.name,
        email: dto.email,
        password_hash: passwordHash,
        full_name: dto.full_name,
        account_type: dto.account_type,
        parent_tenant_id: dto.parent_tenant_id,
        plan_id: dto.plan_id,
        subscription_type: dto.subscription_type,
        bypass_payment: false,
      }),
    );
  }

  async adminCreateTenant(dto: AdminCreateTenantDto): Promise<SignUpResponseDto> {
    const tenantId = uuidv7();
    const ownerId = uuidv7();
    const passwordHash = await bcrypt.hash(dto.password, 10);

    return this.commandBus.execute<RegisterTenantCommand, SignUpResponseDto>(
      new RegisterTenantCommand(tenantId, ownerId, {
        name: dto.name,
        email: dto.email,
        password_hash: passwordHash,
        full_name: dto.full_name,
        account_type: dto.account_type,
        parent_tenant_id: dto.parent_tenant_id,
        plan_id: dto.plan_id,
        subscription_type: dto.subscription_type,
        bypass_payment: true,
      }),
    );
  }

  async activateTenantAfterPayment(metadata: Record<string, string>): Promise<SignUpResponseDto> {
    const tenantId = metadata['tenant_id'] ?? uuidv7();
    const ownerId = metadata['owner_id'] ?? uuidv7();

    return this.commandBus.execute<RegisterTenantCommand, SignUpResponseDto>(
      new RegisterTenantCommand(tenantId, ownerId, {
        name: metadata['name'] ?? '',
        email: metadata['email'] ?? '',
        password_hash: metadata['password_hash'] ?? '',
        full_name: metadata['full_name'] ?? '',
        account_type: (metadata['account_type'] as AccountType) ?? AccountType.STANDARD,
        parent_tenant_id: metadata['parent_tenant_id'],
        plan_id: metadata['plan_id'] ?? '',
        subscription_type: SubscriptionType.PAID,
        bypass_payment: true,
      }),
    );
  }
}
