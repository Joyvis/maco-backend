import { CommandBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';

import { AccountType, SubscriptionType, TenantStatus } from './entities/tenant.entity';
import { TenancyService } from './tenancy.service';

const PLAN_ID = 'cccccccc-0000-7000-8000-000000000001';

describe('TenancyService', () => {
  let service: TenancyService;
  let commandBus: { execute: jest.Mock };

  beforeEach(async () => {
    commandBus = {
      execute: jest.fn().mockResolvedValue({
        tenant_id: 'new-tenant-id',
        status: TenantStatus.TRIAL,
        trial_ends_at: new Date(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TenancyService, { provide: CommandBus, useValue: commandBus }],
    }).compile();

    service = module.get<TenancyService>(TenancyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('registerTenant hashes password and dispatches RegisterTenantCommand', async () => {
    const dto = {
      name: 'Acme Corp',
      email: 'owner@acme.com',
      password: 'Password1!',
      full_name: 'Alice',
      account_type: AccountType.STANDARD,
      plan_id: PLAN_ID,
      subscription_type: SubscriptionType.FREE_TRIAL,
    };

    const result = await service.registerTenant(dto);

    expect(commandBus.execute).toHaveBeenCalledTimes(1);
    const calls = commandBus.execute.mock.calls as [
      { password_hash: string; bypass_payment: boolean },
    ][];
    const command = calls[0]?.[0];
    expect(command?.password_hash).not.toBe('Password1!');
    expect(command?.bypass_payment).toBe(false);
    expect(result.status).toBe(TenantStatus.TRIAL);
  });

  it('adminCreateTenant sets bypass_payment=true', async () => {
    const dto = {
      name: 'Admin Corp',
      email: 'owner@admin.com',
      password: 'Password1!',
      full_name: 'Admin',
      account_type: AccountType.PLATFORM,
      plan_id: PLAN_ID,
      subscription_type: SubscriptionType.PAID,
    };

    await service.adminCreateTenant(dto);

    const calls = commandBus.execute.mock.calls as [{ bypass_payment: boolean }][];
    expect(calls[0]?.[0]?.bypass_payment).toBe(true);
  });

  it('activateTenantAfterPayment uses metadata from Stripe webhook', async () => {
    commandBus.execute.mockResolvedValue({
      tenant_id: 'meta-tenant-id',
      status: TenantStatus.ACTIVE,
    });

    const metadata = {
      tenant_id: 'meta-tenant-id',
      owner_id: 'meta-owner-id',
      name: 'Meta Corp',
      email: 'owner@meta.com',
      password_hash: '$2b$10$hash',
      full_name: 'Meta Owner',
      account_type: AccountType.STANDARD,
      plan_id: PLAN_ID,
    };

    const result = await service.activateTenantAfterPayment(metadata);

    expect(result.status).toBe(TenantStatus.ACTIVE);
    const calls = commandBus.execute.mock.calls as [{ bypass_payment: boolean }][];
    expect(calls[0]?.[0]?.bypass_payment).toBe(true);
  });
});
