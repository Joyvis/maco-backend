// Focused coverage for the stateless `POST /sale-orders/quote` pipeline:
// `quoteBooking` runs the same `normalizeBookingDto → resolveLines →
// resolveAutoIncludeDepsForLines` chain as `createBooking`, minus
// persistence. These specs lock in the invariants the FE review screen
// depends on (matching total, deps as `is_dependency: true` rows,
// dep de-dup against combo-covered services, batched staff-name lookup).

import { ComboItem, ComboItemType } from '@catalog/entities/combo-item.entity';
import { Combo, ComboStatus } from '@catalog/entities/combo.entity';
import { Product, ProductStatus } from '@catalog/entities/product.entity';
import { ServiceDependency } from '@catalog/entities/service-dependency.entity';
import { Service, ServiceStatus } from '@catalog/entities/service.entity';
import { Collection, EntityManager } from '@mikro-orm/core';
import { PaymentsService } from '@payments/payments.service';
import { SchedulingService } from '@scheduling/scheduling.service';
import { Tenant } from '@tenancy/entities/tenant.entity';
import { User } from '@tenancy/entities/user.entity';

import { CommerceService } from './commerce.service';
import { CreateBookingFulfillment, CreateBookingItemType } from './dto/create-booking.dto';

const noopPayments = { startCheckout: jest.fn() } as unknown as PaymentsService;
const noopScheduling = {
  getEligibleStaffForSlot: jest.fn().mockResolvedValue([]),
} as unknown as SchedulingService;

const TENANT_ID = 'tenant-1';
const CUSTOMER_ID = 'customer-1';
const SHOP_SLUG = 'salao-demo';
const SLOT_START = '2026-06-20T13:00:00.000Z';

// ─── Fixture builders ────────────────────────────────────────────────────────

function makeService(
  id: string,
  name: string,
  basePrice: string,
  durationMinutes: number,
): Service {
  const s = new Service();
  s.id = id;
  s.name = name;
  s.tenant_id = TENANT_ID;
  s.base_price = basePrice;
  s.duration_minutes = durationMinutes;
  s.status = ServiceStatus.ACTIVE;
  return s;
}

function makeProduct(id: string, name: string, basePrice: string): Product {
  const p = new Product();
  p.id = id;
  p.name = name;
  p.tenant_id = TENANT_ID;
  p.base_price = basePrice;
  p.status = ProductStatus.ACTIVE;
  return p;
}

function makeComboItem(type: ComboItemType, entity: Service | Product): ComboItem {
  const ci = new ComboItem();
  ci.tenant_id = TENANT_ID;
  ci.item_type = type;
  if (type === ComboItemType.SERVICE) ci.service = entity as Service;
  else ci.product = entity as Product;
  return ci;
}

function makeCombo(
  id: string,
  name: string,
  discountPercentage: string,
  items: ComboItem[],
): Combo {
  const c = new Combo();
  c.id = id;
  c.name = name;
  c.tenant_id = TENANT_ID;
  c.discount_percentage = discountPercentage;
  c.status = ComboStatus.ACTIVE;
  c.items = {
    getItems: () => items,
  } as unknown as Collection<ComboItem>;
  return c;
}

function makeServiceDependency(parent: Service, depService: Service): ServiceDependency {
  const dep = new ServiceDependency();
  dep.tenant_id = TENANT_ID;
  dep.service = parent;
  dep.depends_on_service = depService;
  dep.auto_include = true;
  return dep;
}

// Builds a fake EntityManager that resolves the entities the quote pipeline
// looks up. `serviceById`/`comboById` cover catalog lookups, `depsByServiceId`
// drives `ServiceDependency` queries, and `staffById` populates the
// batched User lookup that feeds `assigned_staff_name`. Anything not listed
// returns null/empty.
function buildFakeEm(opts: {
  serviceById?: Record<string, Service>;
  productById?: Record<string, Product>;
  comboById?: Record<string, Combo>;
  depsByServiceId?: Record<string, ServiceDependency[]>;
  staffById?: Record<string, User>;
}): EntityManager {
  const findOne = jest.fn((entity: unknown, where: Record<string, unknown>) => {
    if (entity === Tenant) return Promise.resolve({ id: TENANT_ID } as Tenant);
    if (entity === User) return Promise.resolve({ id: where.id } as User);
    if (entity === Service) {
      const id = where.id as string;
      return Promise.resolve(opts.serviceById?.[id] ?? null);
    }
    if (entity === Product) {
      const id = where.id as string;
      return Promise.resolve(opts.productById?.[id] ?? null);
    }
    if (entity === Combo) {
      const id = where.id as string;
      return Promise.resolve(opts.comboById?.[id] ?? null);
    }
    return Promise.resolve(null);
  });

  const find = jest.fn((entity: unknown, where: Record<string, unknown>) => {
    if (entity === ServiceDependency) {
      const serviceId = where.service as string;
      return Promise.resolve(opts.depsByServiceId?.[serviceId] ?? []);
    }
    if (entity === User) {
      // batched staff name lookup: where.id is { $in: [...] }
      const inClause = where.id as { $in?: string[] } | undefined;
      const ids = inClause?.$in ?? [];
      return Promise.resolve(
        ids.map((id) => opts.staffById?.[id]).filter((u): u is User => Boolean(u)),
      );
    }
    return Promise.resolve([]);
  });

  return {
    findOne,
    find,
  } as unknown as EntityManager;
}

// ─── Specs ───────────────────────────────────────────────────────────────────

describe('CommerceService.quoteBooking', () => {
  it('returns line_total + total_amount for a single appointment service line', async () => {
    const corte = makeService('svc-corte', 'Corte', '80.00', 60);
    const em = buildFakeEm({
      serviceById: { 'svc-corte': corte },
    });

    const svc = new CommerceService(em, noopPayments, noopScheduling);

    const quote = await svc.quoteBooking(TENANT_ID, CUSTOMER_ID, {
      shop_slug: SHOP_SLUG,
      fulfillment: CreateBookingFulfillment.APPOINTMENT,
      scheduled_start_at: SLOT_START,
      items: [
        {
          catalog_item_type: CreateBookingItemType.SERVICE,
          catalog_item_id: 'svc-corte',
          quantity: 1,
        },
      ],
    });

    expect(quote.fulfillment).toBe('appointment');
    expect(quote.total_amount).toBe(80);
    expect(quote.total_duration_minutes).toBe(60);
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0]).toMatchObject({
      catalog_item_type: 'service',
      catalog_item_id: 'svc-corte',
      name: 'Corte',
      unit_price: 80,
      line_total: 80,
      duration_minutes: 60,
      is_dependency: false,
    });
    expect(quote.scheduled_start_at).toBe(SLOT_START);
    expect(quote.scheduled_end_at).toBe('2026-06-20T14:00:00.000Z');
  });

  it('surfaces auto-include dependencies as is_dependency: true / line_total: 0 rows that do not affect the total', async () => {
    const corte = makeService('svc-corte', 'Corte', '80.00', 60);
    const lavagem = makeService('svc-lavagem', 'Lavagem', '30.00', 15);
    const em = buildFakeEm({
      serviceById: { 'svc-corte': corte, 'svc-lavagem': lavagem },
      depsByServiceId: {
        'svc-corte': [makeServiceDependency(corte, lavagem)],
      },
    });

    const svc = new CommerceService(em, noopPayments, noopScheduling);

    const quote = await svc.quoteBooking(TENANT_ID, CUSTOMER_ID, {
      shop_slug: SHOP_SLUG,
      fulfillment: CreateBookingFulfillment.APPOINTMENT,
      scheduled_start_at: SLOT_START,
      items: [
        {
          catalog_item_type: CreateBookingItemType.SERVICE,
          catalog_item_id: 'svc-corte',
          quantity: 1,
        },
      ],
    });

    // Total is just Corte — the dep contributes 0.
    expect(quote.total_amount).toBe(80);

    expect(quote.lines).toHaveLength(2);
    const depLine = quote.lines.find((l) => l.is_dependency);
    expect(depLine).toMatchObject({
      catalog_item_type: 'service',
      catalog_item_id: 'svc-lavagem',
      name: 'Lavagem',
      unit_price: 0,
      line_total: 0,
      is_dependency: true,
    });
  });

  it('de-dupes an auto-include dependency that the combo already covers (combo + service-with-dep case)', async () => {
    // Mirrors the user-reported scenario: "Corte + Lavagem" combo + Corte
    // (which auto-includes Lavagem). Lavagem is already inside the combo,
    // so the dep MUST NOT appear as a separate line. The total reflects
    // combo discount + Corte's full base_price, nothing else.
    const corte = makeService('svc-corte', 'Corte', '80.00', 60);
    const lavagem = makeService('svc-lavagem', 'Lavagem', '30.00', 15);
    const combo = makeCombo('combo-1', 'Corte + Lavagem', '15.00', [
      makeComboItem(ComboItemType.SERVICE, corte),
      makeComboItem(ComboItemType.SERVICE, lavagem),
    ]);

    const em = buildFakeEm({
      serviceById: { 'svc-corte': corte, 'svc-lavagem': lavagem },
      comboById: { 'combo-1': combo },
      depsByServiceId: {
        'svc-corte': [makeServiceDependency(corte, lavagem)],
      },
    });

    const svc = new CommerceService(em, noopPayments, noopScheduling);

    const quote = await svc.quoteBooking(TENANT_ID, CUSTOMER_ID, {
      shop_slug: SHOP_SLUG,
      fulfillment: CreateBookingFulfillment.APPOINTMENT,
      scheduled_start_at: SLOT_START,
      items: [
        {
          catalog_item_type: CreateBookingItemType.COMBO,
          catalog_item_id: 'combo-1',
          quantity: 1,
        },
        {
          catalog_item_type: CreateBookingItemType.SERVICE,
          catalog_item_id: 'svc-corte',
          quantity: 1,
        },
      ],
    });

    // Combo total = (80 + 30) * 0.85 = 93.50
    // Plus Corte = 80
    // Total = 173.50. NO Lavagem dep added (combo covers it).
    expect(quote.total_amount).toBe(173.5);

    expect(quote.lines).toHaveLength(2);
    expect(quote.lines.some((l) => l.is_dependency)).toBe(false);
  });

  it('de-dupes a dependency referenced by more than one cart line (one dep row, not two)', async () => {
    const corte = makeService('svc-corte', 'Corte', '80.00', 60);
    const coloracao = makeService('svc-coloracao', 'Coloração', '150.00', 90);
    const lavagem = makeService('svc-lavagem', 'Lavagem', '30.00', 15);

    const em = buildFakeEm({
      serviceById: {
        'svc-corte': corte,
        'svc-coloracao': coloracao,
        'svc-lavagem': lavagem,
      },
      depsByServiceId: {
        'svc-corte': [makeServiceDependency(corte, lavagem)],
        'svc-coloracao': [makeServiceDependency(coloracao, lavagem)],
      },
    });

    const svc = new CommerceService(em, noopPayments, noopScheduling);

    const quote = await svc.quoteBooking(TENANT_ID, CUSTOMER_ID, {
      shop_slug: SHOP_SLUG,
      fulfillment: CreateBookingFulfillment.APPOINTMENT,
      scheduled_start_at: SLOT_START,
      items: [
        {
          catalog_item_type: CreateBookingItemType.SERVICE,
          catalog_item_id: 'svc-corte',
          quantity: 1,
        },
        {
          catalog_item_type: CreateBookingItemType.SERVICE,
          catalog_item_id: 'svc-coloracao',
          quantity: 1,
        },
      ],
    });

    expect(quote.total_amount).toBe(230); // 80 + 150
    const depLines = quote.lines.filter((l) => l.is_dependency);
    expect(depLines).toHaveLength(1);
    expect(depLines[0]?.catalog_item_id).toBe('svc-lavagem');
  });

  it('quotes a pickup-only product order at quantity × base_price with no schedule fields', async () => {
    const shampoo = makeProduct('prd-1', 'Shampoo', '30.00');
    const em = buildFakeEm({
      productById: { 'prd-1': shampoo },
    });

    const svc = new CommerceService(em, noopPayments, noopScheduling);

    const quote = await svc.quoteBooking(TENANT_ID, CUSTOMER_ID, {
      shop_slug: SHOP_SLUG,
      fulfillment: CreateBookingFulfillment.PICKUP,
      items: [
        {
          catalog_item_type: CreateBookingItemType.PRODUCT,
          catalog_item_id: 'prd-1',
          quantity: 2,
        },
      ],
    });

    expect(quote.fulfillment).toBe('pickup');
    expect(quote.total_amount).toBe(60);
    expect(quote.total_duration_minutes).toBe(0);
    expect(quote.scheduled_start_at).toBeUndefined();
    expect(quote.scheduled_end_at).toBeUndefined();
    expect(quote.lines[0]).toMatchObject({
      catalog_item_type: 'product',
      quantity: 2,
      unit_price: 30,
      line_total: 60,
    });
  });

  it('rejects an appointment-fulfillment payload with no service or service-bearing combo', async () => {
    const shampoo = makeProduct('prd-1', 'Shampoo', '30.00');
    const em = buildFakeEm({ productById: { 'prd-1': shampoo } });
    const svc = new CommerceService(em, noopPayments, noopScheduling);

    await expect(
      svc.quoteBooking(TENANT_ID, CUSTOMER_ID, {
        shop_slug: SHOP_SLUG,
        fulfillment: CreateBookingFulfillment.APPOINTMENT,
        scheduled_start_at: SLOT_START,
        items: [
          {
            catalog_item_type: CreateBookingItemType.PRODUCT,
            catalog_item_id: 'prd-1',
            quantity: 1,
          },
        ],
      }),
    ).rejects.toThrow(/at least one service or combo/i);
  });

  it('rejects a pickup payload that includes a service or scheduled_start_at', async () => {
    const corte = makeService('svc-corte', 'Corte', '80.00', 60);
    const em = buildFakeEm({ serviceById: { 'svc-corte': corte } });
    const svc = new CommerceService(em, noopPayments, noopScheduling);

    await expect(
      svc.quoteBooking(TENANT_ID, CUSTOMER_ID, {
        shop_slug: SHOP_SLUG,
        fulfillment: CreateBookingFulfillment.PICKUP,
        items: [
          {
            catalog_item_type: CreateBookingItemType.SERVICE,
            catalog_item_id: 'svc-corte',
            quantity: 1,
          },
        ],
      }),
    ).rejects.toThrow(/pickup orders may only contain products/i);

    await expect(
      svc.quoteBooking(TENANT_ID, CUSTOMER_ID, {
        shop_slug: SHOP_SLUG,
        fulfillment: CreateBookingFulfillment.PICKUP,
        scheduled_start_at: SLOT_START,
        items: [
          {
            catalog_item_type: CreateBookingItemType.PRODUCT,
            catalog_item_id: 'prd-1',
            quantity: 1,
          },
        ],
      }),
    ).rejects.toThrow(/scheduled_start_at must not be set/i);
  });
});
