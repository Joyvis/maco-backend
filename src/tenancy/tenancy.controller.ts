import { EntityManager, EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { AllowIncompleteProfile } from './auth/allow-incomplete-profile.decorator';
import { CurrentUser } from './auth/current-user.decorator';
import { RequestUser } from './auth/jwt-payload.interface';
import { Roles } from './auth/roles.decorator';
import { RolesGuard } from './auth/roles.guard';
import { CreateUserCommand } from './commands/create-user.command';
import { AdminCreateTenantDto } from './dto/admin-create-tenant.dto';
import { CreateUserResponseDto } from './dto/create-user-response.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ListUsersResponseDto, ManagedUserDto } from './dto/list-users-response.dto';
import { SignUpResponseDto } from './dto/sign-up-response.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UserMeDto } from './dto/user-me.dto';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { User, UserState } from './entities/user.entity';
import { TenancyService } from './tenancy.service';

@Controller('tenancy')
export class TenancyController {
  constructor(private readonly tenancyService: TenancyService) {}

  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  adminCreate(@Body() dto: AdminCreateTenantDto): Promise<SignUpResponseDto> {
    return this.tenancyService.adminCreateTenant(dto);
  }
}

@Controller('users')
export class UsersController {
  constructor(
    private readonly commandBus: CommandBus,
    @InjectRepository(User)
    private readonly userRepo: EntityRepository<User>,
    private readonly em: EntityManager,
  ) {}

  // Tenant-scoped user listing. Frontend hooks `useStaffList` and
  // `useCustomerSearch` share this endpoint; either passes a role filter
  // (`q[roles_slug_eq]=staff` or `role=customer`) and pagination params.
  // RolesGuard restricts to owner/ta so receptionists can search customers
  // while stylists can't enumerate the tenant's users.
  @Get()
  @UseGuards(RolesGuard)
  @Roles('owner', 'ta')
  async listUsers(
    @Query() query: ListUsersQueryDto,
    @Req() req: { query: Record<string, unknown> },
    @CurrentUser() currentUser: RequestUser,
  ): Promise<ListUsersResponseDto> {
    const page = query.page ?? 1;
    const page_size = query.page_size ?? 20;

    // `q[roles_slug_eq]` survives query parsing as a bracketed key — read it
    // off the raw query rather than the DTO, which can't bind dotted keys.
    const roleFilter =
      query.role ?? (req.query['q[roles_slug_eq]'] as string | undefined) ?? undefined;

    let restrictToUserIds: string[] | null = null;
    if (roleFilter) {
      const role = await this.em.findOne(
        Role,
        { tenant_id: currentUser.tenantId, name: roleFilter },
        { filters: false },
      );
      if (!role) {
        return {
          data: [],
          meta: { total: 0, page, page_size, total_pages: 1 },
        };
      }
      const links = await this.em.find(UserRole, { role: role.id }, { filters: false });
      restrictToUserIds = links.map((l) => l.user.id);
      if (restrictToUserIds.length === 0) {
        return {
          data: [],
          meta: { total: 0, page, page_size, total_pages: 1 },
        };
      }
    }

    const where: Record<string, unknown> = { tenant_id: currentUser.tenantId };
    if (restrictToUserIds) {
      where.id = { $in: restrictToUserIds };
    }
    if (query.search) {
      const term = `%${query.search}%`;
      where.$or = [{ full_name: { $ilike: term } }, { email: { $ilike: term } }];
    }

    const [items, total] = await this.userRepo.findAndCount(where, {
      orderBy: { full_name: 'asc' },
      limit: page_size,
      offset: (page - 1) * page_size,
      populate: ['roles.role'] as never,
      filters: { tenant: false },
    });

    // Visit counts as `customer` on sale_orders — surfaced for the TA's
    // novo-agendamento customer typeahead chip ("N visitas anteriores").
    // Single grouped query keeps it O(1) regardless of page size.
    const userIds = items.map((u) => u.id);
    const visitCounts = new Map<string, number>();
    if (userIds.length > 0) {
      const rows = (await this.em.getConnection().execute(
        `select customer_id, count(*)::int as visit_count from sale_orders
            where tenant_id = ? and customer_id in (${userIds.map(() => '?').join(',')})
            group by customer_id`,
        [currentUser.tenantId, ...userIds],
      )) as Array<{ customer_id: string; visit_count: string | number }>;
      for (const r of rows) visitCounts.set(r.customer_id, Number(r.visit_count) || 0);
    }

    const data: ManagedUserDto[] = items.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.full_name ?? u.phone ?? '',
      phone: u.phone ?? null,
      roles: u.roles.getItems().map((ur) => ({
        id: ur.role.id,
        name: ur.role.name,
      })),
      status: u.state === UserState.ACTIVE ? 'active' : 'inactive',
      created_at: u.created_at.toISOString(),
      visit_count: visitCounts.get(u.id) ?? 0,
    }));

    return {
      data,
      meta: {
        total,
        page,
        page_size,
        total_pages: Math.max(1, Math.ceil(total / page_size)),
      },
    };
  }

  @Get('me')
  @AllowIncompleteProfile()
  async me(@CurrentUser() currentUser: RequestUser): Promise<UserMeDto> {
    const user = await this.userRepo.findOne(
      { id: currentUser.id, tenant_id: currentUser.tenantId },
      { filters: false, populate: ['roles.role'] as never },
    );

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const roles = user.roles.getItems().map((ur) => ur.role.name);

    return {
      id: user.id,
      email: user.email,
      name: user.full_name ?? null,
      phone: user.phone ?? null,
      tenant_id: user.tenant_id,
      roles,
      permissions: [],
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RolesGuard)
  @Roles('owner', 'ta')
  createUser(
    @Body() dto: CreateUserDto,
    @CurrentUser() currentUser: RequestUser,
  ): Promise<CreateUserResponseDto> {
    return this.commandBus.execute(
      new CreateUserCommand(currentUser.tenantId, currentUser.id, {
        email: dto.email,
        full_name: dto.full_name,
        phone: dto.phone,
        initial_roles: dto.initial_roles ?? [],
      }),
    );
  }

  @Patch('me')
  @AllowIncompleteProfile()
  async updateMe(
    @Body() dto: UpdateMeDto,
    @CurrentUser() currentUser: RequestUser,
  ): Promise<UserMeDto> {
    const user = await this.userRepo.findOne(
      { id: currentUser.id, tenant_id: currentUser.tenantId },
      { filters: false, populate: ['roles.role'] as never },
    );

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.full_name !== undefined) {
      const trimmed = dto.full_name.trim();
      user.full_name = trimmed.length > 0 ? trimmed : undefined;
    }

    if (dto.email !== undefined && dto.email !== user.email) {
      const existing = await this.userRepo.findOne(
        { tenant_id: currentUser.tenantId, email: dto.email },
        { filters: false },
      );
      if (existing && existing.id !== user.id) {
        throw new ConflictException('Email already in use');
      }
      user.email = dto.email;
    }

    await this.em.persistAndFlush(user);

    const roles = user.roles.getItems().map((ur) => ur.role.name);

    return {
      id: user.id,
      email: user.email,
      name: user.full_name ?? null,
      phone: user.phone ?? null,
      tenant_id: user.tenant_id,
      roles,
      permissions: [],
    };
  }
}
