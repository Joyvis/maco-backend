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

const ID = {
  SVC_AUTO_FAIL: '01900000-0000-7000-8000-0000000000a0',
  ACME_TENANT: '01900000-0000-7000-8000-0000000000b0',
  ACME_PLAN: '01900000-0000-7000-8000-0000000000b9',
  ACME_ROLE_OWNER: '01900000-0000-7000-8000-0000000000ba',
  ACME_ROLE_STAFF: '01900000-0000-7000-8000-0000000000bb',
  ACME_ROLE_CUSTOMER: '01900000-0000-7000-8000-0000000000bc',
  ACME_ROLE_TA: '01900000-0000-7000-8000-0000000000bd',
  ACME_OWNER: '01900000-0000-7000-8000-0000000000b1',
};

const AUTO_FAIL_NAME = 'Auto Falha';
const AUTO_FAIL_PRICE = '0.34';
const AUTO_FAIL_DURATION = 30;

const ACME_OWNER_EMAIL = 'owner@acme.test';
const ACME_OWNER_PASSWORD = 'Passw0rd!';

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

async function ensureAcmeTenant(em: EntityManager): Promise<Tenant> {
  let tenant = await em.findOne(Tenant, { id: ID.ACME_TENANT }, { filters: false });
  if (!tenant) {
    tenant = em.create(Tenant, {
      id: ID.ACME_TENANT,
      name: 'ACME Salão',
      account_type: AccountType.STANDARD,
      status: TenantStatus.ACTIVE,
      plan_id: ID.ACME_PLAN,
      subscription_type: SubscriptionType.FREE_TRIAL,
      slug: 'acme',
    });
    await em.persistAndFlush(tenant);
  } else if (tenant.status !== TenantStatus.ACTIVE) {
    tenant.status = TenantStatus.ACTIVE;
    await em.flush();
  }
  return tenant;
}

async function ensureAcmeOwner(em: EntityManager, ownerRole: Role): Promise<User> {
  let user = await em.findOne(User, { id: ID.ACME_OWNER }, { filters: false });
  if (!user) {
    user = await em.findOne(
      User,
      { tenant_id: ID.ACME_TENANT, email: ACME_OWNER_EMAIL },
      { filters: false },
    );
  }
  if (!user) {
    const passwordHash = await bcrypt.hash(ACME_OWNER_PASSWORD, 10);
    user = em.create(User, {
      id: ID.ACME_OWNER,
      tenant_id: ID.ACME_TENANT,
      email: ACME_OWNER_EMAIL,
      password_hash: passwordHash,
      full_name: 'ACME Owner',
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

    const acmeTenant = await ensureAcmeTenant(em);
    const acmeRoles = await ensureTenantRoles(em, ID.ACME_TENANT, {
      owner: ID.ACME_ROLE_OWNER,
      staff: ID.ACME_ROLE_STAFF,
      customer: ID.ACME_ROLE_CUSTOMER,
      ta: ID.ACME_ROLE_TA,
    });
    await ensureAcmeOwner(em, acmeRoles.owner);

    console.log('\nE2E seed complete.');
    console.log('  Demo tenant:');
    console.log(`    tenant_id:  ${demo.tenant.id}`);
    console.log(`    shop slug:  ${demo.tenant.slug}`);
    console.log(`    owner:      owner@salao-demo.test / demo1234`);
    console.log(`    ta:         ta@salao-demo.test / demo1234`);
    console.log(`    customer:   customer@demo.test / demo1234`);
    console.log(`    auto-fail:  "${AUTO_FAIL_NAME}" @ R$ ${AUTO_FAIL_PRICE}`);
    console.log('  ACME tenant:');
    console.log(`    tenant_id:  ${acmeTenant.id}`);
    console.log(`    owner:      ${ACME_OWNER_EMAIL} / ${ACME_OWNER_PASSWORD}\n`);
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
