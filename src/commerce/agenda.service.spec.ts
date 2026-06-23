import { Collection, EntityManager } from '@mikro-orm/core';
import { PaymentsService } from '@payments/payments.service';
import { SchedulingService } from '@scheduling/scheduling.service';

import { CommerceService } from './commerce.service';
import { AgendaResponseDto } from './dto/agenda-response.dto';
import { SaleOrderItem, SaleOrderItemType } from './entities/sale-order-item.entity';
import { SaleOrder, SaleOrderFulfillment, SaleOrderState } from './entities/sale-order.entity';

const noopPayments = { startCheckout: jest.fn() } as unknown as PaymentsService;
const noopScheduling = {
  getEligibleStaffForSlot: jest.fn().mockResolvedValue([]),
} as unknown as SchedulingService;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeItem(
  type: SaleOrderItemType,
  serviceName?: string,
  isDependency = false,
): SaleOrderItem {
  const item = new SaleOrderItem();
  item.catalog_item_type = type;
  item.is_dependency = isDependency;
  if (type === SaleOrderItemType.SERVICE && serviceName) {
    item.service = { name: serviceName } as never;
  }
  return item;
}

function makeOrder(
  id: string,
  state: SaleOrderState,
  staffId?: string,
  items: SaleOrderItem[] = [],
): SaleOrder {
  const o = new SaleOrder();
  o.id = id;
  o.state = state;
  o.fulfillment = SaleOrderFulfillment.APPOINTMENT;
  o.total_amount = '50.00';
  o.booking_channel = undefined;
  o.notes = undefined;
  o.scheduled_at = new Date('2026-04-16T09:00:00.000Z');
  o.scheduled_end_at = new Date('2026-04-16T09:30:00.000Z');
  o.created_at = new Date('2026-04-01T00:00:00.000Z');
  o.customer = {
    full_name: 'Test Customer',
    phone: '+5511999999999',
    email: 'customer@test.com',
  } as never;
  if (staffId) {
    o.staff = { id: staffId } as never;
  }
  o.items = { getItems: () => items } as unknown as Collection<SaleOrderItem>;
  return o;
}

function buildFakeEm(opts: {
  timezone?: string;
  orderIds: string[];
  orders: SaleOrder[];
  scheduleRows: Array<{ user_id: string; start_time: string; end_time: string }>;
  staffUsers: Array<{ id: string; full_name: string }>;
}): EntityManager {
  const tzRow = opts.timezone ? { value: opts.timezone } : null;

  const conn = {
    execute: jest
      .fn()
      .mockImplementationOnce(() => Promise.resolve(opts.orderIds.map((id) => ({ id }))))
      .mockImplementationOnce(() => Promise.resolve(opts.scheduleRows)),
  };

  const em = {
    findOne: jest.fn().mockResolvedValue(tzRow),
    find: jest
      .fn()
      .mockImplementationOnce(() => Promise.resolve(opts.orders))
      .mockImplementationOnce(() => Promise.resolve(opts.staffUsers)),
    getConnection: () => conn,
  } as unknown as EntityManager;

  return em;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('CommerceService.getAgenda', () => {
  const TENANT = 'tenant-1';
  const DATE = '2026-04-16';

  it('returns correct shape: staff array + unassigned array', async () => {
    const order1 = makeOrder('order-1', SaleOrderState.CONFIRMED, 'staff-1', [
      makeItem(SaleOrderItemType.SERVICE, 'Haircut'),
    ]);
    const em = buildFakeEm({
      orderIds: ['order-1'],
      orders: [order1],
      scheduleRows: [{ user_id: 'staff-1', start_time: '09:00', end_time: '18:00' }],
      staffUsers: [{ id: 'staff-1', full_name: 'Zé Barbeiro' }],
    });
    const svc = new CommerceService(em, noopPayments, noopScheduling);

    const result: AgendaResponseDto = await svc.getAgenda(TENANT, DATE);

    expect(result).toHaveProperty('staff');
    expect(result).toHaveProperty('unassigned');
    expect(Array.isArray(result.staff)).toBe(true);
    expect(Array.isArray(result.unassigned)).toBe(true);
  });

  it('puts staff-assigned orders under correct staff entry', async () => {
    const order1 = makeOrder('order-1', SaleOrderState.CONFIRMED, 'staff-1', [
      makeItem(SaleOrderItemType.SERVICE, 'Haircut'),
    ]);
    const order2 = makeOrder('order-2', SaleOrderState.CHECKED_IN, 'staff-1', [
      makeItem(SaleOrderItemType.SERVICE, 'Manicure'),
    ]);
    const em = buildFakeEm({
      orderIds: ['order-1', 'order-2'],
      orders: [order1, order2],
      scheduleRows: [{ user_id: 'staff-1', start_time: '09:00', end_time: '18:00' }],
      staffUsers: [{ id: 'staff-1', full_name: 'Zé Barbeiro' }],
    });
    const svc = new CommerceService(em, noopPayments, noopScheduling);

    const result = await svc.getAgenda(TENANT, DATE);

    expect(result.staff).toHaveLength(1);
    expect(result.staff[0]).toMatchObject({
      id: 'staff-1',
      name: 'Zé Barbeiro',
      schedule_start: '09:00',
      schedule_end: '18:00',
      appointment_count: 2,
    });
    expect(result.staff[0].appointments).toHaveLength(2);
    expect(result.unassigned).toHaveLength(0);
  });

  it('puts unassigned orders (staff_id=null) in the unassigned array', async () => {
    const unassigned = makeOrder('order-3', SaleOrderState.CONFIRMED, undefined, [
      makeItem(SaleOrderItemType.SERVICE, 'Cut'),
    ]);
    const em = buildFakeEm({
      orderIds: ['order-3'],
      orders: [unassigned],
      scheduleRows: [],
      staffUsers: [],
    });
    const svc = new CommerceService(em, noopPayments, noopScheduling);

    const result = await svc.getAgenda(TENANT, DATE);

    expect(result.staff).toHaveLength(0);
    expect(result.unassigned).toHaveLength(1);
    expect(result.unassigned[0].id).toBe('order-3');
  });

  it('appointment DTO has all required fields with correct values', async () => {
    const order = makeOrder('order-1', SaleOrderState.CONFIRMED, 'staff-1', [
      makeItem(SaleOrderItemType.SERVICE, 'Haircut'),
      makeItem(SaleOrderItemType.SERVICE, 'Beard'),
    ]);
    order.booking_channel = 'whatsapp' as never;
    order.notes = 'Extra foam';
    const em = buildFakeEm({
      orderIds: ['order-1'],
      orders: [order],
      scheduleRows: [{ user_id: 'staff-1', start_time: '09:00', end_time: '18:00' }],
      staffUsers: [{ id: 'staff-1', full_name: 'Staff One' }],
    });
    const svc = new CommerceService(em, noopPayments, noopScheduling);

    const result = await svc.getAgenda(TENANT, DATE);
    const appt = result.staff[0].appointments[0];

    expect(appt).toMatchObject({
      id: 'order-1',
      customer_name: 'Test Customer',
      customer_phone: '+5511999999999',
      customer_email: 'customer@test.com',
      services: 'Haircut, Beard',
      scheduled_start_at: '2026-04-16T09:00:00.000Z',
      scheduled_end_at: '2026-04-16T09:30:00.000Z',
      duration_minutes: 30,
      state: SaleOrderState.CONFIRMED,
      total: 50,
      booking_channel: 'whatsapp',
      notes: 'Extra foam',
    });
    expect(appt.created_at).toBe(order.created_at.toISOString());
  });

  it('dependency items are excluded from services field', async () => {
    const order = makeOrder('order-1', SaleOrderState.CONFIRMED, 'staff-1', [
      makeItem(SaleOrderItemType.SERVICE, 'Haircut', false),
      makeItem(SaleOrderItemType.SERVICE, 'Treatment', true), // dependency
    ]);
    const em = buildFakeEm({
      orderIds: ['order-1'],
      orders: [order],
      scheduleRows: [{ user_id: 'staff-1', start_time: '09:00', end_time: '18:00' }],
      staffUsers: [{ id: 'staff-1', full_name: 'Staff One' }],
    });
    const svc = new CommerceService(em, noopPayments, noopScheduling);

    const result = await svc.getAgenda(TENANT, DATE);

    expect(result.staff[0].appointments[0].services).toBe('Haircut');
  });

  it('combo items appear in services field by their headline name (not as a list of constituents)', async () => {
    // Cart line for a combo persists as one COMBO row with name_snapshot set
    // to the combo's headline name, plus zero-or-more dependency SERVICE rows
    // for the components. The agenda block on the staff doing the combo must
    // show the combo's headline — never an empty string.
    const comboItem = new SaleOrderItem();
    comboItem.catalog_item_type = SaleOrderItemType.COMBO;
    comboItem.is_dependency = false;
    comboItem.name_snapshot = 'Corte + Lavagem';

    const depService = new SaleOrderItem();
    depService.catalog_item_type = SaleOrderItemType.SERVICE;
    depService.is_dependency = true;
    depService.service = { name: 'Lavagem (auto)' } as never;

    const order = makeOrder('order-1', SaleOrderState.CONFIRMED, 'staff-1', [
      comboItem,
      depService,
    ]);
    const em = buildFakeEm({
      orderIds: ['order-1'],
      orders: [order],
      scheduleRows: [{ user_id: 'staff-1', start_time: '09:00', end_time: '18:00' }],
      staffUsers: [{ id: 'staff-1', full_name: 'Staff One' }],
    });
    const svc = new CommerceService(em, noopPayments, noopScheduling);

    const result = await svc.getAgenda(TENANT, DATE);

    expect(result.staff[0].appointments[0].services).toBe('Corte + Lavagem');
  });

  it('multi-staff order with combo on one staff and standalone service on another: each bucket carries its own headline', async () => {
    // The screenshot bug: Bruno does the combo, Ana does the standalone
    // service. The TA detail sheet must show "Corte + Lavagem" when opened
    // from Bruno's column and "Corte Feminino" when opened from Ana's.
    const comboBruno = new SaleOrderItem();
    comboBruno.catalog_item_type = SaleOrderItemType.COMBO;
    comboBruno.is_dependency = false;
    comboBruno.name_snapshot = 'Corte + Lavagem';
    comboBruno.assigned_staff = { id: 'bruno' } as never;

    const serviceAna = new SaleOrderItem();
    serviceAna.catalog_item_type = SaleOrderItemType.SERVICE;
    serviceAna.is_dependency = false;
    serviceAna.service = { name: 'Corte Feminino' } as never;
    serviceAna.assigned_staff = { id: 'ana' } as never;

    const order = makeOrder('order-1', SaleOrderState.CONFIRMED, undefined, [
      comboBruno,
      serviceAna,
    ]);
    const em = buildFakeEm({
      orderIds: ['order-1'],
      orders: [order],
      scheduleRows: [
        { user_id: 'bruno', start_time: '09:00', end_time: '18:00' },
        { user_id: 'ana', start_time: '09:00', end_time: '18:00' },
      ],
      staffUsers: [
        { id: 'bruno', full_name: 'Bruno Souza' },
        { id: 'ana', full_name: 'Ana Silva' },
      ],
    });
    const svc = new CommerceService(em, noopPayments, noopScheduling);

    const result = await svc.getAgenda(TENANT, DATE);

    const bruno = result.staff.find((s) => s.id === 'bruno')!;
    const ana = result.staff.find((s) => s.id === 'ana')!;
    expect(bruno.appointments[0].services).toBe('Corte + Lavagem');
    expect(ana.appointments[0].services).toBe('Corte Feminino');
  });

  it('drift staff (has order but no schedule) appears with null schedule fields', async () => {
    const order = makeOrder('order-1', SaleOrderState.CONFIRMED, 'staff-drift', [
      makeItem(SaleOrderItemType.SERVICE, 'Cut'),
    ]);
    const em = buildFakeEm({
      orderIds: ['order-1'],
      orders: [order],
      scheduleRows: [], // no schedule for this staff on this day
      staffUsers: [{ id: 'staff-drift', full_name: 'Drift Staff' }],
    });
    const svc = new CommerceService(em, noopPayments, noopScheduling);

    const result = await svc.getAgenda(TENANT, DATE);

    expect(result.staff).toHaveLength(1);
    expect(result.staff[0]).toMatchObject({
      id: 'staff-drift',
      name: 'Drift Staff',
      schedule_start: null,
      schedule_end: null,
      appointment_count: 1,
    });
  });

  it('returns empty staff and unassigned when no orders and no schedules', async () => {
    const em = buildFakeEm({
      orderIds: [],
      orders: [],
      scheduleRows: [],
      staffUsers: [],
    });
    const svc = new CommerceService(em, noopPayments, noopScheduling);

    const result = await svc.getAgenda(TENANT, DATE);

    expect(result).toEqual({ staff: [], unassigned: [] });
  });

  it('staff with schedule but no orders appears with appointment_count 0', async () => {
    const conn = {
      execute: jest
        .fn()
        .mockResolvedValueOnce([]) // no orders
        .mockResolvedValueOnce([{ user_id: 'staff-1', start_time: '09:00', end_time: '18:00' }]),
    };
    const em = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValueOnce([{ id: 'staff-1', full_name: 'Idle Staff' }]),
      getConnection: () => conn,
    } as unknown as EntityManager;
    const svc = new CommerceService(em, noopPayments, noopScheduling);

    const result = await svc.getAgenda(TENANT, DATE);

    expect(result.staff).toHaveLength(1);
    expect(result.staff[0]).toMatchObject({
      id: 'staff-1',
      name: 'Idle Staff',
      schedule_start: '09:00',
      schedule_end: '18:00',
      appointment_count: 0,
      appointments: [],
    });
    expect(result.unassigned).toHaveLength(0);
  });

  it('uses America/Sao_Paulo as default timezone when TenantConfig has no timezone row', async () => {
    const conn = {
      execute: jest.fn().mockResolvedValue([]),
    };
    const em = {
      findOne: jest.fn().mockResolvedValue(null), // no TenantConfig row
      find: jest.fn().mockResolvedValue([]),
      getConnection: () => conn,
    } as unknown as EntityManager;
    const svc = new CommerceService(em, noopPayments, noopScheduling);

    await svc.getAgenda(TENANT, DATE);

    // The first execute call is the order query; verify it includes the default timezone
    const firstCall = conn.execute.mock.calls[0] as [string, unknown[]];
    expect(firstCall[1]).toContain('America/Sao_Paulo');
  });

  it('uses tenant timezone from TenantConfig when present', async () => {
    const conn = {
      execute: jest.fn().mockResolvedValue([]),
    };
    const em = {
      findOne: jest.fn().mockResolvedValue({ value: 'America/New_York' }),
      find: jest.fn().mockResolvedValue([]),
      getConnection: () => conn,
    } as unknown as EntityManager;
    const svc = new CommerceService(em, noopPayments, noopScheduling);

    await svc.getAgenda(TENANT, DATE);

    const firstCall = conn.execute.mock.calls[0] as [string, unknown[]];
    expect(firstCall[1]).toContain('America/New_York');
  });

  it('null fields return null in appointment DTO', async () => {
    const order = makeOrder('order-1', SaleOrderState.CONFIRMED, undefined, [
      makeItem(SaleOrderItemType.SERVICE, 'Cut'),
    ]);
    order.customer = {
      full_name: 'No Phone',
      phone: undefined,
      email: 'noPhone@test.com',
    } as never;
    order.booking_channel = undefined;
    order.notes = undefined;
    const em = buildFakeEm({
      orderIds: ['order-1'],
      orders: [order],
      scheduleRows: [],
      staffUsers: [],
    });
    const svc = new CommerceService(em, noopPayments, noopScheduling);

    const result = await svc.getAgenda(TENANT, DATE);

    expect(result.unassigned[0]).toMatchObject({
      customer_phone: null,
      booking_channel: null,
      notes: null,
    });
  });
});
