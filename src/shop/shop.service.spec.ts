import { Category } from '@catalog/entities/category.entity';
import { Service, ServiceStatus } from '@catalog/entities/service.entity';
import { EntityManager } from '@mikro-orm/core';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@tenancy/entities/role.entity';
import {
  Tenant,
  AccountType,
  SubscriptionType,
  TenantStatus,
} from '@tenancy/entities/tenant.entity';
import { User, UserState } from '@tenancy/entities/user.entity';

import { ShopService } from './shop.service';

interface FindOneArgs {
  entity: unknown;
  where: Record<string, unknown>;
}
interface FindArgs {
  entity: unknown;
  where: Record<string, unknown>;
}

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  const t = new Tenant();
  t.id = 't-1';
  t.name = 'Salão da Maria';
  t.account_type = AccountType.STANDARD;
  t.status = TenantStatus.ACTIVE;
  t.plan_id = 'plan-1';
  t.subscription_type = SubscriptionType.PAID;
  t.slug = 'salao-da-maria';
  t.logo_url = 'https://example.com/logo.png';
  t.city = 'São Paulo';
  t.rating = '4.80';
  Object.assign(t, overrides);
  return t;
}

function makeService(id: string, name: string, categoryName?: string): Service {
  const svc = new Service();
  svc.id = id;
  svc.tenant_id = 't-1';
  svc.name = name;
  svc.duration_minutes = 30;
  svc.base_price = '50.00';
  svc.status = ServiceStatus.ACTIVE;
  if (categoryName) {
    const cat = new Category();
    cat.id = `c-${id}`;
    cat.tenant_id = 't-1';
    cat.name = categoryName;
    svc.category = cat;
  }
  return svc;
}

function makeStaffUser(id: string, fullName: string): User {
  const u = new User();
  u.id = id;
  u.tenant_id = 't-1';
  u.email = `${id}@x.test`;
  u.password_hash = 'x';
  u.full_name = fullName;
  u.state = UserState.ACTIVE;
  return u;
}

describe('ShopService', () => {
  let service: ShopService;
  let findOne: jest.Mock;
  let find: jest.Mock;

  beforeEach(async () => {
    findOne = jest.fn();
    find = jest.fn();

    const em: Partial<EntityManager> = {
      findOne: ((entity: unknown, where: Record<string, unknown>) => {
        return findOne({ entity, where } satisfies FindOneArgs) as unknown;
      }) as EntityManager['findOne'],
      find: ((entity: unknown, where: Record<string, unknown>) => {
        return find({ entity, where } satisfies FindArgs) as unknown;
      }) as EntityManager['find'],
      getConnection: () =>
        ({
          execute: (_sql: string, params: unknown[]) => {
            const roleId = params?.[0];
            if (roleId === 'role-staff') {
              return Promise.resolve([{ user_id: 'u1' }]);
            }
            return Promise.resolve([]);
          },
        }) as unknown as ReturnType<EntityManager['getConnection']>,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ShopService, { provide: EntityManager, useValue: em }],
    }).compile();

    service = module.get<ShopService>(ShopService);
  });

  it('returns full shop profile with services and staff', async () => {
    const tenant = makeTenant();
    const services = [makeService('s1', 'Corte', 'Cabelo'), makeService('s2', 'Barba')];
    const staffRole = new Role();
    staffRole.id = 'role-staff';
    staffRole.tenant_id = 't-1';
    staffRole.name = 'staff';

    const staffUser = makeStaffUser('u1', 'Maria');

    findOne.mockImplementation(({ entity, where }: FindOneArgs) => {
      if (entity === Tenant && where['slug'] === 'salao-da-maria') return Promise.resolve(tenant);
      if (entity === Role && where['name'] === 'staff') return Promise.resolve(staffRole);
      return Promise.resolve(null);
    });
    find.mockImplementation(({ entity }: FindArgs) => {
      if (entity === Service) return Promise.resolve(services);
      if (entity === User) return Promise.resolve([staffUser]);
      return Promise.resolve([]);
    });

    const profile = await service.getShopProfile('salao-da-maria');

    expect(profile.slug).toBe('salao-da-maria');
    expect(profile.name).toBe('Salão da Maria');
    expect(profile.city).toBe('São Paulo');
    expect(profile.rating).toBe(4.8);
    expect(profile.services).toEqual([
      {
        id: 's1',
        name: 'Corte',
        category: 'Cabelo',
        duration_minutes: 30,
        base_price: 50,
        description: undefined,
      },
      {
        id: 's2',
        name: 'Barba',
        category: undefined,
        duration_minutes: 30,
        base_price: 50,
        description: undefined,
      },
    ]);
    expect(profile.staff).toEqual([{ user_id: 'u1', name: 'Maria', qualified_services: [] }]);
  });

  it('throws NotFoundException when no tenant has the slug', async () => {
    findOne.mockResolvedValue(null);

    await expect(service.getShopProfile('does-not-exist')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns empty staff when no staff role exists', async () => {
    const tenant = makeTenant();
    findOne.mockImplementation(({ entity }: FindOneArgs) => {
      if (entity === Tenant) return Promise.resolve(tenant);
      return Promise.resolve(null);
    });
    find.mockImplementation(({ entity }: FindArgs) => {
      if (entity === Service) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const profile = await service.getShopProfile('salao-da-maria');

    expect(profile.staff).toEqual([]);
    expect(profile.services).toEqual([]);
  });
});
