import 'reflect-metadata';

import { MikroORM, EntityManager } from '@mikro-orm/core';
import * as bcrypt from 'bcrypt';

import config from '../../mikro-orm.config';
import { Category } from '../catalog/entities/category.entity';
import { Service, ServiceStatus } from '../catalog/entities/service.entity';
import { Role } from '../tenancy/entities/role.entity';
import { StaffQualification } from '../tenancy/entities/staff-qualification.entity';
import { AccountType, Tenant } from '../tenancy/entities/tenant.entity';
import { UserRole } from '../tenancy/entities/user-role.entity';
import { User, UserState } from '../tenancy/entities/user.entity';

const DEMO_SLUG = 'salao-da-maria';
const DEMO_CITY = 'São Paulo';
const DEMO_LOGO_URL =
  'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=400&h=400&fit=crop';
const DEMO_RATING = '4.80';
const DEMO_CATEGORY = 'Cabelo';

interface DemoService {
  name: string;
  description: string;
  duration_minutes: number;
  base_price: string;
}

const DEMO_SERVICES: DemoService[] = [
  {
    name: 'Corte feminino',
    description: 'Corte com lavagem e finalização.',
    duration_minutes: 60,
    base_price: '80.00',
  },
  {
    name: 'Coloração',
    description: 'Coloração completa com produtos profissionais.',
    duration_minutes: 120,
    base_price: '180.00',
  },
  {
    name: 'Escova',
    description: 'Lavagem e escova modeladora.',
    duration_minutes: 45,
    base_price: '60.00',
  },
];

interface DemoStaff {
  email: string;
  full_name: string;
}

const DEMO_STAFF: DemoStaff[] = [
  { email: 'maria@salao-da-maria.demo', full_name: 'Maria Silva' },
  { email: 'joana@salao-da-maria.demo', full_name: 'Joana Costa' },
];

async function pickDemoTenant(em: EntityManager): Promise<Tenant> {
  const tenant = await em.findOne(
    Tenant,
    { account_type: { $ne: AccountType.PLATFORM } },
    { orderBy: { created_at: 'asc' }, filters: false },
  );
  if (!tenant) {
    throw new Error(
      'No non-platform tenant found. Run the sign-up flow first to create a local dev tenant.',
    );
  }
  return tenant;
}

async function ensureTenantBranding(em: EntityManager, tenant: Tenant): Promise<void> {
  let dirty = false;
  if (!tenant.slug) {
    tenant.slug = DEMO_SLUG;
    dirty = true;
  }
  if (!tenant.city) {
    tenant.city = DEMO_CITY;
    dirty = true;
  }
  if (!tenant.logo_url) {
    tenant.logo_url = DEMO_LOGO_URL;
    dirty = true;
  }
  if (tenant.rating === undefined || tenant.rating === null) {
    tenant.rating = DEMO_RATING;
    dirty = true;
  }
  if (dirty) await em.flush();
}

async function ensureCategory(em: EntityManager, tenantId: string): Promise<Category> {
  const existing = await em.findOne(
    Category,
    { tenant_id: tenantId, name: DEMO_CATEGORY },
    { filters: false },
  );
  if (existing) return existing;

  const category = em.create(Category, {
    tenant_id: tenantId,
    name: DEMO_CATEGORY,
    display_order: 1,
  });
  await em.persistAndFlush(category);
  return category;
}

interface EnsureServicesResult {
  services: Service[];
  created: number;
}

async function ensureServices(
  em: EntityManager,
  tenantId: string,
  category: Category,
): Promise<EnsureServicesResult> {
  let created = 0;
  const services: Service[] = [];
  for (const svc of DEMO_SERVICES) {
    const existing = await em.findOne(
      Service,
      { tenant_id: tenantId, name: svc.name },
      { filters: false },
    );
    if (existing) {
      if (existing.status !== ServiceStatus.ACTIVE) {
        existing.status = ServiceStatus.ACTIVE;
      }
      services.push(existing);
      continue;
    }
    const entity = em.create(Service, {
      tenant_id: tenantId,
      name: svc.name,
      description: svc.description,
      category,
      duration_minutes: svc.duration_minutes,
      base_price: svc.base_price,
      status: ServiceStatus.ACTIVE,
    });
    em.persist(entity);
    services.push(entity);
    created++;
  }
  await em.flush();
  return { services, created };
}

interface EnsureStaffResult {
  created: number;
  qualified: number;
}

async function ensureStaff(
  em: EntityManager,
  tenantId: string,
  services: Service[],
): Promise<EnsureStaffResult> {
  const staffRole = await em.findOne(
    Role,
    { tenant_id: tenantId, name: 'staff' },
    { filters: false },
  );
  if (!staffRole) {
    console.warn('No "staff" role found for tenant; skipping staff seed.');
    return { created: 0, qualified: 0 };
  }

  let created = 0;
  let qualified = 0;
  for (const member of DEMO_STAFF) {
    const existing = await em.findOne(
      User,
      { tenant_id: tenantId, email: member.email },
      { filters: false },
    );
    let user = existing;
    if (!user) {
      const passwordHash = await bcrypt.hash(`demo-${Date.now()}`, 10);
      user = em.create(User, {
        tenant_id: tenantId,
        email: member.email,
        password_hash: passwordHash,
        full_name: member.full_name,
        state: UserState.ACTIVE,
      });
      em.persist(user);
      created++;
    }
    await em.flush();

    const link = await em.findOne(
      UserRole,
      { user: user.id, role: staffRole.id },
      { filters: false },
    );
    if (!link) {
      const ur = em.create(UserRole, { user, role: staffRole });
      em.persist(ur);
      await em.flush();
    }

    // Qualify each demo staff member for every demo service so the shop's
    // bookable-services filter (in shop.service.ts) doesn't drop them.
    for (const svc of services) {
      const existingQual = await em.findOne(
        StaffQualification,
        { tenant_id: tenantId, user: user.id, service: svc.id },
        { filters: false },
      );
      if (!existingQual) {
        em.persist(
          em.create(StaffQualification, {
            tenant_id: tenantId,
            user,
            service: svc,
          }),
        );
        qualified++;
      }
    }
    await em.flush();
  }
  return { created, qualified };
}

async function run(): Promise<void> {
  const orm = await MikroORM.init(config);
  try {
    const em = orm.em.fork();

    const tenant = await pickDemoTenant(em);
    console.log(`Using tenant: ${tenant.id} (${tenant.name})`);

    await ensureTenantBranding(em, tenant);
    const category = await ensureCategory(em, tenant.id);
    const { services, created: newServices } = await ensureServices(em, tenant.id, category);
    const { created: newStaff, qualified: newQualifications } = await ensureStaff(
      em,
      tenant.id,
      services,
    );

    const slug = tenant.slug ?? DEMO_SLUG;
    console.log(`\nSeed complete:`);
    console.log(`  slug:                 ${slug}`);
    console.log(`  city:                 ${tenant.city ?? '-'}`);
    console.log(`  logo_url:             ${tenant.logo_url ?? '-'}`);
    console.log(`  rating:               ${tenant.rating ?? '-'}`);
    console.log(`  services created:     ${newServices}`);
    console.log(`  staff created:        ${newStaff}`);
    console.log(`  qualifications added: ${newQualifications}`);
    console.log(`\nOpen in browser:`);
    console.log(`  http://localhost:3000/shop/${slug}\n`);
  } finally {
    await orm.close(true);
  }
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
