import 'reflect-metadata';

import { EntityManager, MikroORM } from '@mikro-orm/core';
import * as bcrypt from 'bcrypt';

import config from '../../mikro-orm.config';
import { Category } from '../catalog/entities/category.entity';
import { Service, ServiceStatus } from '../catalog/entities/service.entity';
import { Role } from '../tenancy/entities/role.entity';
import { StaffQualification } from '../tenancy/entities/staff-qualification.entity';
import {
  AccountType,
  SubscriptionType,
  Tenant,
  TenantStatus,
} from '../tenancy/entities/tenant.entity';
import { UserRole } from '../tenancy/entities/user-role.entity';
import { User, UserState } from '../tenancy/entities/user.entity';

import { ensureTenantRoles, runDemoSeed } from './demo.seed';

// Source of truth for e2e credentials. The frontend's e2e/credentials.ts
// mirrors these — keep both files in sync when changing emails or passwords.
//
// Personas:
//   - Platform Admin → manages all tenants (platform-type tenant)
//   - Tenant Owner   → owner@salao-demo.test (seeded by runDemoSeed)
//   - Tenant Staff   → ana@salao-demo.test (seeded by runDemoSeed; designated TA)
//   - Customer       → customer@demo.test  (seeded by runDemoSeed)

const ID = {
  SVC_AUTO_FAIL: '01900000-0000-7000-8000-0000000000a0',
  PLATFORM_TENANT: '01900000-0000-7000-8000-0000000000d0',
  PLATFORM_PLAN: '01900000-0000-7000-8000-0000000000d9',
  PLATFORM_ROLE_OWNER: '01900000-0000-7000-8000-0000000000da',
  PLATFORM_ROLE_STAFF: '01900000-0000-7000-8000-0000000000db',
  PLATFORM_ROLE_CUSTOMER: '01900000-0000-7000-8000-0000000000dc',
  PLATFORM_ROLE_TA: '01900000-0000-7000-8000-0000000000dd',
  PLATFORM_OWNER: '01900000-0000-7000-8000-0000000000d1',
};

const AUTO_FAIL_NAME = 'Auto Falha';
const AUTO_FAIL_PRICE = '0.34';
const AUTO_FAIL_DURATION = 30;

const PLATFORM_ADMIN_EMAIL = 'platform@maco.test';
const PLATFORM_ADMIN_PASSWORD = 'demo1234';

async function ensureAutoFailService(
  em: EntityManager,
  tenant: Tenant,
  category: Category,
  staff: Map<string, User>,
): Promise<Service> {
  let svc = await em.findOne(Service, { id: ID.SVC_AUTO_FAIL }, { filters: false });
  if (!svc) {
    svc = em.create(Service, {
      id: ID.SVC_AUTO_FAIL,
      tenant_id: tenant.id,
      name: AUTO_FAIL_NAME,
      category,
      duration_minutes: AUTO_FAIL_DURATION,
      base_price: AUTO_FAIL_PRICE,
      status: ServiceStatus.ACTIVE,
    });
    em.persist(svc);
  } else {
    svc.name = AUTO_FAIL_NAME;
    svc.base_price = AUTO_FAIL_PRICE;
    svc.duration_minutes = AUTO_FAIL_DURATION;
    if (svc.status !== ServiceStatus.ACTIVE) svc.status = ServiceStatus.ACTIVE;
  }
  await em.flush();

  for (const user of staff.values()) {
    const existing = await em.findOne(
      StaffQualification,
      { tenant_id: tenant.id, user: user.id, service: svc.id },
      { filters: false },
    );
    if (existing) continue;
    em.persist(
      em.create(StaffQualification, {
        tenant_id: tenant.id,
        user,
        service: svc,
      }),
    );
  }
  await em.flush();
  return svc;
}

async function ensurePlatformTenant(em: EntityManager): Promise<Tenant> {
  let tenant = await em.findOne(Tenant, { id: ID.PLATFORM_TENANT }, { filters: false });
  if (!tenant) {
    tenant = em.create(Tenant, {
      id: ID.PLATFORM_TENANT,
      name: 'MACO Platform',
      account_type: AccountType.PLATFORM,
      status: TenantStatus.ACTIVE,
      plan_id: ID.PLATFORM_PLAN,
      subscription_type: SubscriptionType.PAID,
      slug: 'platform',
    });
    await em.persistAndFlush(tenant);
  } else if (tenant.status !== TenantStatus.ACTIVE) {
    tenant.status = TenantStatus.ACTIVE;
    await em.flush();
  }
  return tenant;
}

async function ensurePlatformAdmin(em: EntityManager, ownerRole: Role): Promise<User> {
  let user = await em.findOne(User, { id: ID.PLATFORM_OWNER }, { filters: false });
  if (!user) {
    user = await em.findOne(
      User,
      { tenant_id: ID.PLATFORM_TENANT, email: PLATFORM_ADMIN_EMAIL },
      { filters: false },
    );
  }
  if (!user) {
    const passwordHash = await bcrypt.hash(PLATFORM_ADMIN_PASSWORD, 10);
    user = em.create(User, {
      id: ID.PLATFORM_OWNER,
      tenant_id: ID.PLATFORM_TENANT,
      email: PLATFORM_ADMIN_EMAIL,
      password_hash: passwordHash,
      full_name: 'MACO Platform Admin',
      state: UserState.ACTIVE,
    });
    await em.persistAndFlush(user);
  }
  const link = await em.findOne(
    UserRole,
    { user: user.id, role: ownerRole.id },
    { filters: false },
  );
  if (!link) {
    em.persist(em.create(UserRole, { user, role: ownerRole }));
    await em.flush();
  }
  return user;
}

async function run(): Promise<void> {
  const orm = await MikroORM.init(config);
  try {
    const em = orm.em.fork();

    const demo = await runDemoSeed(em);
    await ensureAutoFailService(em, demo.tenant, demo.category, demo.staff);

    const platformTenant = await ensurePlatformTenant(em);
    const platformRoles = await ensureTenantRoles(em, ID.PLATFORM_TENANT, {
      owner: ID.PLATFORM_ROLE_OWNER,
      staff: ID.PLATFORM_ROLE_STAFF,
      customer: ID.PLATFORM_ROLE_CUSTOMER,
      ta: ID.PLATFORM_ROLE_TA,
    });
    await ensurePlatformAdmin(em, platformRoles.owner);

    console.log('\nE2E seed complete.');
    console.log('  Demo tenant:');
    console.log(`    tenant_id:    ${demo.tenant.id}`);
    console.log(`    shop slug:    ${demo.tenant.slug}`);
    console.log(`    owner:        owner@salao-demo.test / demo1234`);
    console.log(`    ta (staff):   ana@salao-demo.test / demo1234`);
    console.log(`    customer:     customer@demo.test / demo1234`);
    console.log(`    auto-fail:    "${AUTO_FAIL_NAME}" @ R$ ${AUTO_FAIL_PRICE}`);
    console.log('  Platform tenant:');
    console.log(`    tenant_id:    ${platformTenant.id}`);
    console.log(`    platform:     ${PLATFORM_ADMIN_EMAIL} / ${PLATFORM_ADMIN_PASSWORD}\n`);
  } finally {
    await orm.close(true);
  }
}

if (require.main === module) {
  run().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
