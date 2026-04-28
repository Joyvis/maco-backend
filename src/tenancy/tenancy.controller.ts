import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
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
  constructor(private readonly commandBus: CommandBus) {}

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
