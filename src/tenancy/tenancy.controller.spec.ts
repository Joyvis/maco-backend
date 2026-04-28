import { CommandBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';

import { RequestUser } from './auth/jwt-payload.interface';
import { RolesGuard } from './auth/roles.guard';
import { CreateUserResponseDto } from './dto/create-user-response.dto';
import { UserRoleType } from './dto/create-user.dto';
import { TenancyController, UsersController } from './tenancy.controller';
import { TenancyService } from './tenancy.service';

describe('TenancyController', () => {
  let controller: TenancyController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenancyController],
      providers: [TenancyService, { provide: CommandBus, useValue: { execute: jest.fn() } }],
    }).compile();

    controller = module.get<TenancyController>(TenancyController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

describe('UsersController', () => {
  let controller: UsersController;
  let commandBus: { execute: jest.Mock };

  const mockUser: RequestUser = {
    id: 'actor-id',
    tenantId: 'tenant-id',
    roles: ['owner'],
  };

  const mockResponse: CreateUserResponseDto = {
    id: 'new-user-id',
    tenant_id: 'tenant-id',
    email: 'new@example.com',
    full_name: 'John Doe',
    phone: null,
    state: 'active',
    roles: ['staff'],
    created_at: new Date().toISOString(),
  };

  beforeEach(async () => {
    commandBus = { execute: jest.fn().mockResolvedValue(mockResponse) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: CommandBus, useValue: commandBus }],
    })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('dispatches CreateUserCommand via CommandBus and returns result', async () => {
    const dto = {
      email: 'new@example.com',
      full_name: 'John Doe',
      initial_roles: [UserRoleType.STAFF],
    };

    const result = await controller.createUser(dto, mockUser);

    expect(commandBus.execute).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockResponse);
  });

  it('passes tenant_id and user_id from @CurrentUser() to the command', async () => {
    const dto = { email: 'new@example.com', full_name: 'John Doe' };

    await controller.createUser(dto, mockUser);

    const [command] = commandBus.execute.mock.calls[0] as [{ tenant_id: string; user_id: string }];
    expect(command.tenant_id).toBe('tenant-id');
    expect(command.user_id).toBe('actor-id');
  });

  it('defaults initial_roles to empty array when not provided', async () => {
    const dto = { email: 'new@example.com', full_name: 'Jane Doe' };

    await controller.createUser(dto, mockUser);

    const [command] = commandBus.execute.mock.calls[0] as [{ initial_roles: string[] }];
    expect(command.initial_roles).toEqual([]);
  });
});
