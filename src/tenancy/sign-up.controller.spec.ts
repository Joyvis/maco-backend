import { CommandBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';

import { AccountType, SubscriptionType, TenantStatus } from './entities/tenant.entity';
import { SignUpController } from './sign-up.controller';
import { TenancyService } from './tenancy.service';

const PLAN_ID = 'cccccccc-0000-7000-8000-000000000001';

describe('SignUpController', () => {
  let controller: SignUpController;
  let commandBus: { execute: jest.Mock };

  beforeEach(async () => {
    commandBus = {
      execute: jest.fn().mockResolvedValue({ tenant_id: 'tid', status: TenantStatus.TRIAL }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SignUpController],
      providers: [TenancyService, { provide: CommandBus, useValue: commandBus }],
    }).compile();

    controller = module.get<SignUpController>(SignUpController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('signUp delegates to TenancyService.registerTenant and returns result', async () => {
    const dto = {
      name: 'Acme',
      email: 'owner@acme.com',
      password: 'Password1!',
      full_name: 'Alice',
      account_type: AccountType.STANDARD,
      plan_id: PLAN_ID,
      subscription_type: SubscriptionType.FREE_TRIAL,
    };

    const result = await controller.signUp(dto);

    expect(commandBus.execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(TenantStatus.TRIAL);
  });
});
