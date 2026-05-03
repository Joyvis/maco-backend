import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { CurrentUser } from './auth/current-user.decorator';
import { RequestUser } from './auth/jwt-payload.interface';
import { Roles } from './auth/roles.decorator';
import { RolesGuard } from './auth/roles.guard';
import { CreateUserCommand } from './commands/create-user.command';
import { AdminCreateTenantDto } from './dto/admin-create-tenant.dto';
import { CreateUserResponseDto } from './dto/create-user-response.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { SignUpResponseDto } from './dto/sign-up-response.dto';
import { UserMeDto } from './dto/user-me.dto';
import { User } from './entities/user.entity';
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
  ) {}

  @Get('me')
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
      name: user.full_name,
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
}
