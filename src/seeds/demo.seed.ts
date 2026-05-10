import 'reflect-metadata';

import { EntityManager, MikroORM } from '@mikro-orm/core';
import * as bcrypt from 'bcrypt';

import config from '../../mikro-orm.config';
import { Category } from '../catalog/entities/category.entity';
import { ComboItem, ComboItemType } from '../catalog/entities/combo-item.entity';
import { Combo, ComboStatus } from '../catalog/entities/combo.entity';
import { Product, ProductStatus, ProductUnit } from '../catalog/entities/product.entity';
import { ServiceDependency } from '../catalog/entities/service-dependency.entity';
import { Service, ServiceStatus } from '../catalog/entities/service.entity';
import { RefundPolicy } from '../commerce/entities/refund-policy.entity';
import { SaleOrderItem, SaleOrderItemType } from '../commerce/entities/sale-order-item.entity';
import {
  SaleOrder,
  SaleOrderFulfillment,
  SaleOrderState,
} from '../commerce/entities/sale-order.entity';
import { StaffSchedule } from '../scheduling/entities/staff-schedule.entity';
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

const ID = {
  TENANT: '01900000-0000-7000-8000-000000000001',
  PLAN: '01900000-0000-7000-8000-000000000099',
  CATEGORY_HAIR: '01900000-0000-7000-8000-000000000010',
  SVC_CORTE: '01900000-0000-7000-8000-000000000020',
  SVC_ESCOVA: '01900000-0000-7000-8000-000000000021',
  SVC_COLORACAO: '01900000-0000-7000-8000-000000000022',
  SVC_LAVAGEM: '01900000-0000-7000-8000-000000000023',
  ROLE_OWNER: '01900000-0000-7000-8000-000000000030',
  ROLE_STAFF: '01900000-0000-7000-8000-000000000031',
  ROLE_CUSTOMER: '01900000-0000-7000-8000-000000000032',
  OWNER: '01900000-0000-7000-8000-000000000033',
  STAFF_ANA: '01900000-0000-7000-8000-000000000040',
  STAFF_BRUNO: '01900000-0000-7000-8000-000000000041',
  STAFF_CARLA: '01900000-0000-7000-8000-000000000042',
  CUSTOMER: '01900000-0000-7000-8000-000000000050',
  PRODUCT_SHAMPOO: '01900000-0000-7000-8000-000000000080',
  COMBO_CORTE_LAVAGEM: '01900000-0000-7000-8000-000000000090',
  COMBO_ITEM_CORTE: '01900000-0000-7000-8000-000000000091',
  COMBO_ITEM_LAVAGEM: '01900000-0000-7000-8000-000000000092',
  REFUND_DEFAULT: '01900000-0000-7000-8000-000000000060',
  REFUND_HALF: '01900000-0000-7000-8000-000000000061',
  ORDER_FUTURE: '01900000-0000-7000-8000-000000000070',
  ORDER_COMPLETED: '01900000-0000-7000-8000-000000000071',
  ORDER_CANCELLED: '01900000-0000-7000-8000-000000000072',
};

const SHOP_SLUG = 'salao-demo';

const SHOP_ADDRESS = {
  line1: 'Av. Paulista, 1000',
  city: 'São Paulo',
  state: 'SP',
  postal_code: '01310-100',
  latitude: '-23.561300',
  longitude: '-46.656500',
};

async function ensureTenant(em: EntityManager): Promise<Tenant> {
  let tenant = await em.findOne(Tenant, { id: ID.TENANT }, { filters: false });
  if (tenant) return tenant;

  tenant = em.create(Tenant, {
    id: ID.TENANT,
    name: 'Salão Demo',
    account_type: AccountType.STANDARD,
    status: TenantStatus.ACTIVE,
    plan_id: ID.PLAN,
    subscription_type: SubscriptionType.FREE_TRIAL,
    slug: SHOP_SLUG,
    logo_url: 'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=400&h=400&fit=crop',
    city: SHOP_ADDRESS.city,
    rating: '4.80',
    address_line1: SHOP_ADDRESS.line1,
    state: SHOP_ADDRESS.state,
    postal_code: SHOP_ADDRESS.postal_code,
    latitude: SHOP_ADDRESS.latitude,
    longitude: SHOP_ADDRESS.longitude,
  });
  await em.persistAndFlush(tenant);
  return tenant;
}

async function ensureBranding(em: EntityManager, tenant: Tenant): Promise<void> {
  let dirty = false;
  if (tenant.slug !== SHOP_SLUG) {
    tenant.slug = SHOP_SLUG;
    dirty = true;
  }
  if (tenant.city !== SHOP_ADDRESS.city) {
    tenant.city = SHOP_ADDRESS.city;
    dirty = true;
  }
  if (!tenant.logo_url) {
    tenant.logo_url =
      'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=400&h=400&fit=crop';
    dirty = true;
  }
  if (tenant.rating === undefined || tenant.rating === null) {
    tenant.rating = '4.80';
    dirty = true;
  }
  if (tenant.status !== TenantStatus.ACTIVE) {
    tenant.status = TenantStatus.ACTIVE;
    dirty = true;
  }
  if (tenant.address_line1 !== SHOP_ADDRESS.line1) {
    tenant.address_line1 = SHOP_ADDRESS.line1;
    dirty = true;
  }
  if (tenant.state !== SHOP_ADDRESS.state) {
    tenant.state = SHOP_ADDRESS.state;
    dirty = true;
  }
  if (tenant.postal_code !== SHOP_ADDRESS.postal_code) {
    tenant.postal_code = SHOP_ADDRESS.postal_code;
    dirty = true;
  }
  if (tenant.latitude !== SHOP_ADDRESS.latitude) {
    tenant.latitude = SHOP_ADDRESS.latitude;
    dirty = true;
  }
  if (tenant.longitude !== SHOP_ADDRESS.longitude) {
    tenant.longitude = SHOP_ADDRESS.longitude;
    dirty = true;
  }
  if (dirty) await em.flush();
}

export async function ensureTenantRoles(
  em: EntityManager,
  tenantId: string,
  ids: { owner: string; staff: string; customer: string },
): Promise<{
  owner: Role;
  staff: Role;
  customer: Role;
}> {
  const roles: Record<string, Role> = {};
  const want = [
    { id: ids.owner, name: 'owner' },
    { id: ids.staff, name: 'staff' },
    { id: ids.customer, name: 'customer' },
  ];
  for (const r of want) {
    let role = await em.findOne(Role, { tenant_id: tenantId, name: r.name }, { filters: false });
    if (!role) {
      role = em.create(Role, {
        id: r.id,
        tenant_id: tenantId,
        name: r.name,
        is_system: true,
      });
      em.persist(role);
    }
    roles[r.name] = role;
  }
  await em.flush();
  return { owner: roles.owner, staff: roles.staff, customer: roles.customer };
}

async function ensureCategory(em: EntityManager): Promise<Category> {
  let category = await em.findOne(Category, { id: ID.CATEGORY_HAIR }, { filters: false });
  if (!category) {
    category = em.create(Category, {
      id: ID.CATEGORY_HAIR,
      tenant_id: ID.TENANT,
      name: 'Cabelo',
      display_order: 1,
    });
    await em.persistAndFlush(category);
  }
  return category;
}

interface SeedService {
  id: string;
  name: string;
  duration_minutes: number;
  base_price: string;
}

const SERVICES: SeedService[] = [
  { id: ID.SVC_CORTE, name: 'Corte Feminino', duration_minutes: 60, base_price: '80.00' },
  { id: ID.SVC_ESCOVA, name: 'Escova', duration_minutes: 45, base_price: '50.00' },
  { id: ID.SVC_COLORACAO, name: 'Coloração', duration_minutes: 120, base_price: '200.00' },
  { id: ID.SVC_LAVAGEM, name: 'Lavagem', duration_minutes: 15, base_price: '30.00' },
];

async function ensureServices(
  em: EntityManager,
  category: Category,
): Promise<Map<string, Service>> {
  const map = new Map<string, Service>();
  for (const s of SERVICES) {
    let svc = await em.findOne(Service, { id: s.id }, { filters: false });
    if (!svc) {
      svc = em.create(Service, {
        id: s.id,
        tenant_id: ID.TENANT,
        name: s.name,
        category,
        duration_minutes: s.duration_minutes,
        base_price: s.base_price,
        status: ServiceStatus.ACTIVE,
      });
      em.persist(svc);
    } else {
      svc.name = s.name;
      svc.duration_minutes = s.duration_minutes;
      svc.base_price = s.base_price;
      if (svc.status !== ServiceStatus.ACTIVE) svc.status = ServiceStatus.ACTIVE;
    }
    map.set(s.id, svc);
  }
  await em.flush();
  return map;
}

async function ensureDependencies(
  em: EntityManager,
  services: Map<string, Service>,
): Promise<void> {
  const lavagem = services.get(ID.SVC_LAVAGEM)!;
  const pairs = [
    { parent: services.get(ID.SVC_CORTE)!, dep: lavagem },
    { parent: services.get(ID.SVC_COLORACAO)!, dep: lavagem },
  ];
  for (const { parent, dep } of pairs) {
    const existing = await em.findOne(
      ServiceDependency,
      { tenant_id: ID.TENANT, service: parent.id, depends_on_service: dep.id },
      { filters: false },
    );
    if (existing) {
      if (!existing.auto_include) existing.auto_include = true;
      continue;
    }
    em.persist(
      em.create(ServiceDependency, {
        tenant_id: ID.TENANT,
        service: parent,
        depends_on_service: dep,
        auto_include: true,
      }),
    );
  }
  await em.flush();
}

interface SeedStaff {
  id: string;
  email: string;
  full_name: string;
  qualifications: string[];
}

const STAFF: SeedStaff[] = [
  {
    id: ID.STAFF_ANA,
    email: 'ana@salao-demo.test',
    full_name: 'Ana Silva',
    qualifications: [ID.SVC_CORTE, ID.SVC_ESCOVA, ID.SVC_LAVAGEM],
  },
  {
    id: ID.STAFF_BRUNO,
    email: 'bruno@salao-demo.test',
    full_name: 'Bruno Souza',
    qualifications: [ID.SVC_CORTE, ID.SVC_COLORACAO, ID.SVC_LAVAGEM],
  },
  {
    id: ID.STAFF_CARLA,
    email: 'carla@salao-demo.test',
    full_name: 'Carla Lima',
    qualifications: [ID.SVC_ESCOVA, ID.SVC_COLORACAO, ID.SVC_LAVAGEM],
  },
];

async function ensureStaff(
  em: EntityManager,
  staffRole: Role,
  services: Map<string, Service>,
): Promise<Map<string, User>> {
  const passwordHash = await bcrypt.hash('demo1234', 10);
  const map = new Map<string, User>();
  for (const s of STAFF) {
    let user = await em.findOne(User, { id: s.id }, { filters: false });
    if (!user) {
      user = em.create(User, {
        id: s.id,
        tenant_id: ID.TENANT,
        email: s.email,
        password_hash: passwordHash,
        full_name: s.full_name,
        state: UserState.ACTIVE,
      });
      em.persist(user);
      await em.flush();
    }
    map.set(s.id, user);

    const roleLink = await em.findOne(
      UserRole,
      { user: user.id, role: staffRole.id },
      { filters: false },
    );
    if (!roleLink) {
      em.persist(em.create(UserRole, { user, role: staffRole }));
    }

    for (const svcId of s.qualifications) {
      const svc = services.get(svcId)!;
      const existing = await em.findOne(
        StaffQualification,
        { tenant_id: ID.TENANT, user: user.id, service: svc.id },
        { filters: false },
      );
      if (!existing) {
        em.persist(
          em.create(StaffQualification, {
            tenant_id: ID.TENANT,
            user,
            service: svc,
          }),
        );
      }
    }
  }
  await em.flush();
  return map;
}

async function ensureWorkingHours(em: EntityManager, staff: Map<string, User>): Promise<void> {
  for (const user of staff.values()) {
    for (let dow = 1; dow <= 6; dow++) {
      for (const block of [
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '18:00' },
      ]) {
        const existing = await em.findOne(
          StaffSchedule,
          {
            tenant_id: ID.TENANT,
            user: user.id,
            day_of_week: dow,
            start_time: block.start,
          },
          { filters: false },
        );
        if (existing) continue;
        em.persist(
          em.create(StaffSchedule, {
            tenant_id: ID.TENANT,
            user,
            day_of_week: dow,
            start_time: block.start,
            end_time: block.end,
          }),
        );
      }
    }
  }
  await em.flush();
}

async function ensureOwner(em: EntityManager, ownerRole: Role): Promise<User> {
  const email = 'owner@salao-demo.test';
  let user = await em.findOne(User, { id: ID.OWNER }, { filters: false });
  if (!user) {
    user = await em.findOne(User, { tenant_id: ID.TENANT, email }, { filters: false });
  }
  if (!user) {
    const passwordHash = await bcrypt.hash('demo1234', 10);
    user = em.create(User, {
      id: ID.OWNER,
      tenant_id: ID.TENANT,
      email,
      password_hash: passwordHash,
      full_name: 'Owner Demo',
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

interface SeedProduct {
  id: string;
  name: string;
  description: string;
  unit: ProductUnit;
  base_price: string;
}

const PRODUCTS: SeedProduct[] = [
  {
    id: ID.PRODUCT_SHAMPOO,
    name: 'Shampoo Premium',
    description: 'Shampoo profissional para cabelos tratados.',
    unit: ProductUnit.UNIT,
    base_price: '45.00',
  },
];

async function ensureProducts(em: EntityManager): Promise<void> {
  for (const p of PRODUCTS) {
    let product = await em.findOne(Product, { id: p.id }, { filters: false });
    if (!product) {
      product = em.create(Product, {
        id: p.id,
        tenant_id: ID.TENANT,
        name: p.name,
        description: p.description,
        unit: p.unit,
        base_price: p.base_price,
        status: ProductStatus.ACTIVE,
      });
      em.persist(product);
    } else if (product.status !== ProductStatus.ACTIVE) {
      product.status = ProductStatus.ACTIVE;
    }
  }
  await em.flush();
}

async function ensureCombos(
  em: EntityManager,
  services: Map<string, Service>,
): Promise<void> {
  const corte = services.get(ID.SVC_CORTE);
  const lavagem = services.get(ID.SVC_LAVAGEM);
  if (!corte || !lavagem) return;

  const existingCombo = await em.findOne(
    Combo,
    { id: ID.COMBO_CORTE_LAVAGEM },
    { filters: false },
  );
  let combo: Combo;
  if (!existingCombo) {
    combo = em.create(Combo, {
      id: ID.COMBO_CORTE_LAVAGEM,
      tenant_id: ID.TENANT,
      name: 'Corte + Lavagem',
      description: 'Pacote com Corte Feminino e Lavagem com 15% de desconto.',
      discount_percentage: '15.00',
      status: ComboStatus.ACTIVE,
    });
    em.persist(combo);
    await em.flush();
  } else {
    combo = existingCombo;
    combo.name = 'Corte + Lavagem';
    combo.description = 'Pacote com Corte Feminino e Lavagem com 15% de desconto.';
    combo.discount_percentage = '15.00';
    combo.status = ComboStatus.ACTIVE;
  }

  const desiredItems: Array<{ id: string; service: Service }> = [
    { id: ID.COMBO_ITEM_CORTE, service: corte },
    { id: ID.COMBO_ITEM_LAVAGEM, service: lavagem },
  ];
  for (const desired of desiredItems) {
    const existing = await em.findOne(ComboItem, { id: desired.id }, { filters: false });
    if (!existing) {
      em.persist(
        em.create(ComboItem, {
          id: desired.id,
          tenant_id: ID.TENANT,
          combo,
          item_type: ComboItemType.SERVICE,
          service: desired.service,
        }),
      );
    }
  }
  await em.flush();
}

async function ensureCustomer(em: EntityManager, customerRole: Role): Promise<User> {
  const email = 'customer@demo.test';
  let user = await em.findOne(User, { id: ID.CUSTOMER }, { filters: false });
  if (!user) {
    user = await em.findOne(User, { tenant_id: ID.TENANT, email }, { filters: false });
  }
  if (!user) {
    const passwordHash = await bcrypt.hash('demo1234', 10);
    user = em.create(User, {
      id: ID.CUSTOMER,
      tenant_id: ID.TENANT,
      email,
      password_hash: passwordHash,
      full_name: 'Demo Customer',
      state: UserState.ACTIVE,
    });
    await em.persistAndFlush(user);
  }
  const link = await em.findOne(
    UserRole,
    { user: user.id, role: customerRole.id },
    { filters: false },
  );
  if (!link) {
    em.persist(em.create(UserRole, { user, role: customerRole }));
    await em.flush();
  }
  return user;
}

async function ensureRefundPolicies(em: EntityManager): Promise<void> {
  const want = [
    {
      id: ID.REFUND_DEFAULT,
      description: 'Cancelamentos com mais de 24h de antecedência têm reembolso total.',
      refund_percentage: 100,
    },
    {
      id: ID.REFUND_HALF,
      description: 'Cancelamentos com menos de 24h têm reembolso de 50%.',
      refund_percentage: 50,
    },
  ];
  for (const w of want) {
    const existing = await em.findOne(RefundPolicy, { id: w.id }, { filters: false });
    if (existing) continue;
    em.persist(
      em.create(RefundPolicy, {
        id: w.id,
        tenant_id: ID.TENANT,
        description: w.description,
        refund_percentage: w.refund_percentage,
        is_active: true,
      }),
    );
  }
  await em.flush();
}

async function ensureSeedOrders(
  em: EntityManager,
  customer: User,
  services: Map<string, Service>,
  staff: Map<string, User>,
): Promise<void> {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(10, 0, 0, 0);
  const lastWeek = new Date();
  lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
  lastWeek.setUTCHours(14, 0, 0, 0);
  const lastMonth = new Date();
  lastMonth.setUTCDate(lastMonth.getUTCDate() - 14);
  lastMonth.setUTCHours(11, 0, 0, 0);

  const seeds = [
    {
      id: ID.ORDER_FUTURE,
      service: services.get(ID.SVC_CORTE)!,
      staff: staff.get(ID.STAFF_ANA)!,
      state: SaleOrderState.CONFIRMED,
      start: tomorrow,
    },
    {
      id: ID.ORDER_COMPLETED,
      service: services.get(ID.SVC_ESCOVA)!,
      staff: staff.get(ID.STAFF_CARLA)!,
      state: SaleOrderState.COMPLETED,
      start: lastWeek,
    },
    {
      id: ID.ORDER_CANCELLED,
      service: services.get(ID.SVC_ESCOVA)!,
      staff: staff.get(ID.STAFF_CARLA)!,
      state: SaleOrderState.CANCELLED,
      start: lastMonth,
      cancellation_reason: 'personal',
      cancelled_at: lastMonth,
    },
  ];

  for (const s of seeds) {
    const existing = await em.findOne(SaleOrder, { id: s.id }, { filters: false });
    if (existing) continue;
    const end = new Date(s.start.getTime() + s.service.duration_minutes * 60_000);
    const total = Number(s.service.base_price);
    const order = em.create(SaleOrder, {
      id: s.id,
      tenant_id: ID.TENANT,
      customer,
      service: s.service,
      staff: s.staff,
      state: s.state,
      fulfillment: SaleOrderFulfillment.APPOINTMENT,
      scheduled_at: s.start,
      scheduled_end_at: end,
      total_amount: total.toFixed(2),
      requires_payment: false,
      cancellation_reason: 'cancellation_reason' in s ? s.cancellation_reason : undefined,
      cancelled_at: 'cancelled_at' in s ? s.cancelled_at : undefined,
    });
    em.persist(order);
    em.persist(
      em.create(SaleOrderItem, {
        tenant_id: ID.TENANT,
        sale_order: order,
        catalog_item_type: SaleOrderItemType.SERVICE,
        catalog_item_id: s.service.id,
        service: s.service,
        quantity: 1,
        price: total.toFixed(2),
        is_dependency: false,
        slot_start_at: s.start,
        slot_end_at: end,
        assigned_staff: s.staff,
      }),
    );
  }
  await em.flush();
}

export interface DemoSeedHandles {
  tenant: Tenant;
  category: Category;
  services: Map<string, Service>;
  staff: Map<string, User>;
  roles: { owner: Role; staff: Role; customer: Role };
  customer: User;
}

export async function runDemoSeed(em: EntityManager): Promise<DemoSeedHandles> {
  const tenant = await ensureTenant(em);
  await ensureBranding(em, tenant);
  const roles = await ensureTenantRoles(em, ID.TENANT, {
    owner: ID.ROLE_OWNER,
    staff: ID.ROLE_STAFF,
    customer: ID.ROLE_CUSTOMER,
  });
  const category = await ensureCategory(em);
  const services = await ensureServices(em, category);
  await ensureDependencies(em, services);
  await ensureProducts(em);
  await ensureCombos(em, services);
  const staff = await ensureStaff(em, roles.staff, services);
  await ensureWorkingHours(em, staff);
  await ensureOwner(em, roles.owner);
  const customer = await ensureCustomer(em, roles.customer);
  await ensureRefundPolicies(em);
  await ensureSeedOrders(em, customer, services, staff);

  return { tenant, category, services, staff, roles, customer };
}

export const DEMO_SHOP_SLUG = SHOP_SLUG;

async function run(): Promise<void> {
  const orm = await MikroORM.init(config);
  try {
    const em = orm.em.fork();

    const { tenant } = await runDemoSeed(em);

    console.log('\nDemo seed complete.');
    console.log(`  tenant_id:   ${tenant.id}`);
    console.log(`  shop slug:   ${SHOP_SLUG}`);
    console.log(`  owner:       owner@salao-demo.test / demo1234`);
    console.log(`  customer:    customer@demo.test / demo1234`);
    console.log(`\nOpen in browser:`);
    console.log(`  http://localhost:3000/shop/${SHOP_SLUG}\n`);
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
