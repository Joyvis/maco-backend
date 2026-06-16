// The agenda DTO must expose the order's canonical scheduled_start_at /
// scheduled_end_at (same semantic as `/sale-orders`) so the detail sheet
// renders the same start in every staff column for a multi-staff combo.
// Per-column block placement lives in the new block_* fields used by the
// agenda grid.

import { Collection, EntityManager } from '@mikro-orm/core';
import { PaymentsService } from '@payments/payments.service';
import { SchedulingService } from '@scheduling/scheduling.service';

import { CommerceService } from './commerce.service';
import { SaleOrderItem, SaleOrderItemType } from './entities/sale-order-item.entity';
import { SaleOrder, SaleOrderFulfillment, SaleOrderState } from './entities/sale-order.entity';

const noopPayments = { startCheckout: jest.fn() } as unknown as PaymentsService;
const noopScheduling = {
  getEligibleStaffForSlot: jest.fn().mockResolvedValue([]),
} as unknown as SchedulingService;

function makeServiceItem(
  staffId: string,
  serviceName: string,
  slotStart: string,
  slotEnd: string,
): SaleOrderItem {
  const item = new SaleOrderItem();
  item.catalog_item_type = SaleOrderItemType.SERVICE;
  item.is_dependency = false;
  item.service = { name: serviceName } as never;
  item.assigned_staff = { id: staffId } as never;
  item.slot_start_at = new Date(slotStart);
  item.slot_end_at = new Date(slotEnd);
  return item;
}

function buildOrderWithItems(items: SaleOrderItem[]): SaleOrder {
  const order = new SaleOrder();
  order.id = 'order-1';
  order.state = SaleOrderState.CONFIRMED;
  order.fulfillment = SaleOrderFulfillment.APPOINTMENT;
  order.total_amount = '100.00';
  order.scheduled_at = new Date('2026-04-16T09:00:00.000Z');
  order.scheduled_end_at = new Date('2026-04-16T09:45:00.000Z');
  order.created_at = new Date('2026-04-01T00:00:00.000Z');
  order.customer = {
    full_name: 'Combo Customer',
    phone: '+5511988887777',
    email: 'combo@test.com',
  } as never;
  order.items = {
    getItems: () => items,
  } as unknown as Collection<SaleOrderItem>;
  return order;
}

describe('CommerceService.getAgenda — canonical vs block times', () => {
  it('returns the order canonical start (09:00) for every staff column of a multi-staff combo', async () => {
    const itemA = makeServiceItem(
      'staff-X',
      'Hair',
      '2026-04-16T09:00:00.000Z',
      '2026-04-16T09:15:00.000Z',
    );
    const itemB = makeServiceItem(
      'staff-Y',
      'Beard',
      '2026-04-16T09:15:00.000Z',
      '2026-04-16T09:45:00.000Z',
    );
    const order = buildOrderWithItems([itemA, itemB]);

    const conn = {
      execute: jest
        .fn()
        .mockImplementationOnce(() => Promise.resolve([{ id: 'order-1' }]))
        .mockImplementationOnce(() =>
          Promise.resolve([
            { user_id: 'staff-X', start_time: '09:00', end_time: '18:00' },
            { user_id: 'staff-Y', start_time: '09:00', end_time: '18:00' },
          ]),
        ),
    };
    const em = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest
        .fn()
        .mockImplementationOnce(() => Promise.resolve([order]))
        .mockImplementationOnce(() =>
          Promise.resolve([
            { id: 'staff-X', full_name: 'Staff X' },
            { id: 'staff-Y', full_name: 'Staff Y' },
          ]),
        ),
      getConnection: () => conn,
    } as unknown as EntityManager;

    const svc = new CommerceService(em, noopPayments, noopScheduling);
    const result = await svc.getAgenda('tenant-1', '2026-04-16');

    const staffX = result.staff.find((s) => s.id === 'staff-X')!;
    const staffY = result.staff.find((s) => s.id === 'staff-Y')!;

    // Canonical: same scheduled_start_at in every column for the same order.
    expect(staffX.appointments[0].scheduled_start_at).toBe('2026-04-16T09:00:00.000Z');
    expect(staffY.appointments[0].scheduled_start_at).toBe('2026-04-16T09:00:00.000Z');
    expect(staffX.appointments[0].scheduled_end_at).toBe('2026-04-16T09:45:00.000Z');
    expect(staffY.appointments[0].scheduled_end_at).toBe('2026-04-16T09:45:00.000Z');
    expect(staffX.appointments[0].duration_minutes).toBe(45);
    expect(staffY.appointments[0].duration_minutes).toBe(45);

    // Per-column block window: each column carries its own staff's slot.
    expect(staffX.appointments[0].block_start_at).toBe('2026-04-16T09:00:00.000Z');
    expect(staffX.appointments[0].block_end_at).toBe('2026-04-16T09:15:00.000Z');
    expect(staffX.appointments[0].block_duration_minutes).toBe(15);

    expect(staffY.appointments[0].block_start_at).toBe('2026-04-16T09:15:00.000Z');
    expect(staffY.appointments[0].block_end_at).toBe('2026-04-16T09:45:00.000Z');
    expect(staffY.appointments[0].block_duration_minutes).toBe(30);
  });

  it('combo order whose first service has no dependency: combo item carries the 09:00 start so block_start_at is 09:00 (not pulled to 09:15 by the second service dependency)', async () => {
    // Combo of two services persisted as ONE combo item that exposes its
    // own slot window via slot_start_at/slot_end_at. The second service has
    // an auto-included dependency persisted at slot 09:15→09:45, which used
    // to pull the per-column min to 09:15 because the combo item itself
    // had no slot data.
    const comboItem = new SaleOrderItem();
    comboItem.catalog_item_type = SaleOrderItemType.COMBO;
    comboItem.is_dependency = false;
    comboItem.name_snapshot = 'Combo Full';
    comboItem.assigned_staff = { id: 'staff-1' } as never;
    comboItem.slot_start_at = new Date('2026-04-16T09:00:00.000Z');
    comboItem.slot_end_at = new Date('2026-04-16T09:45:00.000Z');

    const depItem = new SaleOrderItem();
    depItem.catalog_item_type = SaleOrderItemType.SERVICE;
    depItem.is_dependency = true;
    depItem.service = { name: 'Wash (auto)' } as never;
    depItem.assigned_staff = { id: 'staff-1' } as never;
    depItem.slot_start_at = new Date('2026-04-16T09:15:00.000Z');
    depItem.slot_end_at = new Date('2026-04-16T09:45:00.000Z');

    const order = buildOrderWithItems([comboItem, depItem]);

    const conn = {
      execute: jest
        .fn()
        .mockImplementationOnce(() => Promise.resolve([{ id: 'order-1' }]))
        .mockImplementationOnce(() =>
          Promise.resolve([{ user_id: 'staff-1', start_time: '09:00', end_time: '18:00' }]),
        ),
    };
    const em = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest
        .fn()
        .mockImplementationOnce(() => Promise.resolve([order]))
        .mockImplementationOnce(() => Promise.resolve([{ id: 'staff-1', full_name: 'Staff 1' }])),
      getConnection: () => conn,
    } as unknown as EntityManager;

    const svc = new CommerceService(em, noopPayments, noopScheduling);
    const result = await svc.getAgenda('tenant-1', '2026-04-16');
    const appt = result.staff[0].appointments[0];

    expect(appt.scheduled_start_at).toBe('2026-04-16T09:00:00.000Z');
    expect(appt.block_start_at).toBe('2026-04-16T09:00:00.000Z');
    expect(appt.block_end_at).toBe('2026-04-16T09:45:00.000Z');
  });

  it('legacy order without per-item slot times falls back to order-level scheduled_at on both canonical AND block fields', async () => {
    const item = new SaleOrderItem();
    item.catalog_item_type = SaleOrderItemType.SERVICE;
    item.is_dependency = false;
    item.service = { name: 'Cut' } as never;
    item.assigned_staff = { id: 'staff-1' } as never;
    // No slot_start_at / slot_end_at — legacy non-cart booking.

    const order = buildOrderWithItems([item]);

    const conn = {
      execute: jest
        .fn()
        .mockImplementationOnce(() => Promise.resolve([{ id: 'order-1' }]))
        .mockImplementationOnce(() =>
          Promise.resolve([{ user_id: 'staff-1', start_time: '09:00', end_time: '18:00' }]),
        ),
    };
    const em = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest
        .fn()
        .mockImplementationOnce(() => Promise.resolve([order]))
        .mockImplementationOnce(() => Promise.resolve([{ id: 'staff-1', full_name: 'Staff 1' }])),
      getConnection: () => conn,
    } as unknown as EntityManager;

    const svc = new CommerceService(em, noopPayments, noopScheduling);
    const result = await svc.getAgenda('tenant-1', '2026-04-16');
    const appt = result.staff[0].appointments[0];

    expect(appt.scheduled_start_at).toBe('2026-04-16T09:00:00.000Z');
    expect(appt.block_start_at).toBe('2026-04-16T09:00:00.000Z');
    expect(appt.scheduled_end_at).toBe('2026-04-16T09:45:00.000Z');
    expect(appt.block_end_at).toBe('2026-04-16T09:45:00.000Z');
    expect(appt.duration_minutes).toBe(45);
    expect(appt.block_duration_minutes).toBe(45);
  });
});
