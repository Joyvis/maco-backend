import { EntityManager } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import * as bcrypt from 'bcrypt';
import { uuidv7 } from 'uuidv7';

import { RegisterTenantCommand } from './commands/register-tenant.command';
import { AdminCreateTenantDto } from './dto/admin-create-tenant.dto';
import { ListUsersQueryDto, ListUsersResponseDto } from './dto/list-users-query.dto';
import { SignUpResponseDto } from './dto/sign-up-response.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { AccountType, SubscriptionType } from './entities/tenant.entity';
import { User } from './entities/user.entity';

const noTenantFilter = () => ({ filters: { tenant: false } });

@Injectable()
export class TenancyService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly em: EntityManager,
  ) {}

  async listUsers(tenantId: string, query: ListUsersQueryDto): Promise<ListUsersResponseDto> {
    const page = query.page ?? 1;
    const page_size = query.page_size ?? 50;
    const search = query.search?.trim();
    const role = query.role?.trim();

    const where: Record<string, unknown> = { tenant_id: tenantId };

    if (search && search.length > 0) {
      const pattern = `%${search}%`;
      where.$or = [{ full_name: { $ilike: pattern } }, { phone: { $ilike: pattern } }];
    }

    if (role) {
      where.roles = { role: { name: role } };
    }

    const [users, total] = await this.em.findAndCount(User, where, {
      orderBy: { full_name: 'asc' },
      limit: page_size,
      offset: (page - 1) * page_size,
      populate: ['roles.role'] as never,
      ...noTenantFilter(),
    });

    return {
      data: users.map((u) => ({
        id: u.id,
        email: u.email,
        full_name: u.full_name,
        name: u.full_name,
        phone: u.phone ?? null,
        roles: u.roles.getItems().map((ur) => ur.role.name),
        visit_count: 0,
      })),
      meta: { total, page, page_size },
    };
  }

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
