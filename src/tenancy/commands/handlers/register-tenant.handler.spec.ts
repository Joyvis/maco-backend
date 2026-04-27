import { EntityManager } from '@mikro-orm/core';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { ConflictException } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';

import { Role } from '../../entities/role.entity';
import { AccountType, SubscriptionType, TenantStatus, Tenant } from '../../entities/tenant.entity';
import { UserRole } from '../../entities/user-role.entity';
import { User } from '../../entities/user.entity';
import { TenantRegisteredEvent } from '../../events/tenant-registered.event';
import { RegisterTenantCommand } from '../register-tenant.command';

import { RegisterTenantHandler } from './register-tenant.handler';

const TENANT_ID = 'aaaaaaaa-0000-7000-8000-000000000001';
const USER_ID = 'bbbbbbbb-0000-7000-8000-000000000001';
const PLAN_ID = 'cccccccc-0000-7000-8000-000000000001';

interface CommandParams {
  name?: string;
  email?: string;
  password_hash?: string;
  full_name?: string;
  account_type?: AccountType;
  parent_tenant_id?: string;
  plan_id?: string;
  subscription_type?: SubscriptionType;
  bypass_payment?: boolean;
}

function makeCommand(overrides: CommandParams = {}) {
  return new RegisterTenantCommand(TENANT_ID, USER_ID, {
    name: 'Acme Corp',
    email: 'owner@acme.com',
    password_hash: '$2b$10$hashedpw',
    full_name: 'Alice Owner',
    account_type: AccountType.STANDARD,
    plan_id: PLAN_ID,
    subscription_type: SubscriptionType.FREE_TRIAL,
    ...overrides,
  });
}

describe('RegisterTenantHandler', () => {
  let handler: RegisterTenantHandler;
  let tenantRepo: { findOne: jest.Mock };
  let em: { create: jest.Mock; persistAndFlush: jest.Mock };
  let eventBus: jest.Mocked<EventBus>;

  beforeEach(async () => {
    tenantRepo = { findOne: jest.fn().mockResolvedValue(null) };
    em = {
      create: jest.fn().mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({
        ...data,
        created_at: new Date(),
      })),
      persistAndFlush: jest.fn().mockResolvedValue(undefined),
    };
    eventBus = { publish: jest.fn() } as unknown as jest.Mocked<EventBus>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegisterTenantHandler,
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: EntityManager, useValue: em },
        { provide: EventBus, useValue: eventBus },
      ],
    }).compile();

    handler = module.get(RegisterTenantHandler);
  });

  // AC: free_trial → TRIAL status, trial_ends_at set
  it('creates tenant with TRIAL status for free_trial subscription', async () => {
    const command = makeCommand({ subscription_type: SubscriptionType.FREE_TRIAL });
    const result = await handler.execute(command);

    expect(result.status).toBe(TenantStatus.TRIAL);
    expect(result.trial_ends_at).toBeInstanceOf(Date);
    expect(result.tenant_id).toBe(TENANT_ID);
  });

  // AC: default roles seeded — owner, ta, staff, customer (is_system=true)
  it('seeds 4 default system roles for the new tenant', async () => {
    const command = makeCommand();
    await handler.execute(command);

    const allCalls = em.create.mock.calls as [unknown, Record<string, unknown>][];
    const roleCalls = allCalls.filter((c) => c[0] === Role);
    expect(roleCalls).toHaveLength(4);

    const names = roleCalls.map((c) => c[1]['name'] as string);
    expect(names).toEqual(expect.arrayContaining(['owner', 'ta', 'staff', 'customer']));

    for (const call of roleCalls) {
      expect(call[1]['is_system']).toBe(true);
      expect(call[1]['tenant_id']).toBe(TENANT_ID);
    }
  });

  // AC: owner user created
  it('creates owner user with correct email and tenant_id', async () => {
    const command = makeCommand();
    await handler.execute(command);

    const allCalls = em.create.mock.calls as [unknown, Record<string, unknown>][];
    const userCalls = allCalls.filter((c) => c[0] === User);
    expect(userCalls).toHaveLength(1);
    expect(userCalls[0]?.[1]['id']).toBe(USER_ID);
    expect(userCalls[0]?.[1]['email']).toBe('owner@acme.com');
    expect(userCalls[0]?.[1]['tenant_id']).toBe(TENANT_ID);
  });

  // AC: user_roles entry created for owner → owner role
  it('creates user_role linking owner user to owner role', async () => {
    const command = makeCommand();
    await handler.execute(command);

    const allCalls = em.create.mock.calls as [unknown, Record<string, unknown>][];
    const urCalls = allCalls.filter((c) => c[0] === UserRole);
    expect(urCalls).toHaveLength(1);
    expect((urCalls[0]?.[1]['role'] as Record<string, unknown>)['name']).toBe('owner');
  });

  // AC: TenantRegistered event emitted with correct payload
  it('emits TenantRegisteredEvent with correct payload', async () => {
    const command = makeCommand();
    await handler.execute(command);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    const event = eventBus.publish.mock.calls[0][0] as TenantRegisteredEvent;
    expect(event).toBeInstanceOf(TenantRegisteredEvent);
    expect(event.tenant_id).toBe(TENANT_ID);
    expect(event.owner_user_id).toBe(USER_ID);
    expect(event.source_command).toBe('RegisterTenantCommand');
    expect(event.correlation_id).toBe(command.correlation_id);
    expect(event.account_type).toBe(AccountType.STANDARD);
  });

  // AC: unique name per parent validated
  it('throws ConflictException when tenant name already exists for same parent', async () => {
    tenantRepo.findOne.mockResolvedValue({ id: 'existing', name: 'Acme Corp' });
    const command = makeCommand();

    await expect(handler.execute(command)).rejects.toThrow(ConflictException);
  });

  // AC: PA admin bypass_payment=true creates ACTIVE tenant
  it('creates tenant with ACTIVE status when bypass_payment=true', async () => {
    const command = makeCommand({
      subscription_type: SubscriptionType.PAID,
      bypass_payment: true,
    });
    const result = await handler.execute(command);

    expect(result.status).toBe(TenantStatus.ACTIVE);
    expect(result.trial_ends_at).toBeUndefined();
  });

  // AC: paid plan without bypass returns checkout_url (no tenant created)
  it('returns checkout_url without creating tenant for paid plan without bypass', async () => {
    const command = makeCommand({ subscription_type: SubscriptionType.PAID });
    const result = await handler.execute(command);

    expect(result.checkout_url).toBeDefined();
    expect(result.status).toBe(TenantStatus.PENDING_PAYMENT);

    const tenantCalls = (em.create.mock.calls as [unknown, unknown][]).filter(
      (c) => c[0] === Tenant,
    );
    expect(tenantCalls).toHaveLength(0);
  });
});
