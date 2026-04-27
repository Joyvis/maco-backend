import { EntityManager, RequestContext } from '@mikro-orm/core';
import { Test, TestingModule } from '@nestjs/testing';

import { TenantConfig } from '../../entities/tenant-config.entity';
import { AccountType } from '../../entities/tenant.entity';
import { TenantRegisteredEvent } from '../tenant-registered.event';

import { TenantOnboardingHandler } from './tenant-onboarding.handler';

const TENANT_ID = 'aaaaaaaa-0000-7000-8000-000000000002';

function makeEvent(): TenantRegisteredEvent {
  return new TenantRegisteredEvent(
    TENANT_ID,
    'corr-id-123',
    AccountType.STANDARD,
    'user-id-1',
    new Date(),
  );
}

describe('TenantOnboardingHandler', () => {
  let handler: TenantOnboardingHandler;
  let em: { create: jest.Mock; persistAndFlush: jest.Mock };

  beforeEach(async () => {
    em = {
      create: jest.fn().mockImplementation((_e: unknown, data: unknown) => data),
      persistAndFlush: jest.fn().mockResolvedValue(undefined),
    };

    jest
      .spyOn(RequestContext, 'create')
      .mockImplementation((_em: unknown, next: (...args: unknown[]) => unknown) => next());

    const module: TestingModule = await Test.createTestingModule({
      providers: [TenantOnboardingHandler, { provide: EntityManager, useValue: em }],
    }).compile();

    handler = module.get<TenantOnboardingHandler>(TenantOnboardingHandler);
  });

  it('seeds 3 default tenant configs via persistAndFlush', async () => {
    const event = makeEvent();
    await handler.process(event);

    const configCalls = em.create.mock.calls as [unknown, Record<string, unknown>][];
    const tenantConfigCalls = configCalls.filter((c) => c[0] === TenantConfig);
    expect(tenantConfigCalls).toHaveLength(3);

    const keys = tenantConfigCalls.map((c) => c[1]['key'] as string);
    expect(keys).toEqual(expect.arrayContaining(['locale', 'timezone', 'max_users']));

    expect(em.persistAndFlush).toHaveBeenCalledTimes(1);
  });

  it('each config has correct tenant_id', async () => {
    const event = makeEvent();
    await handler.process(event);

    const configCalls = (em.create.mock.calls as [unknown, Record<string, unknown>][]).filter(
      (c) => c[0] === TenantConfig,
    );
    for (const call of configCalls) {
      expect(call[1]['tenant_id']).toBe(TENANT_ID);
    }
  });
});
