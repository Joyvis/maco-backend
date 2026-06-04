import { Service } from '@catalog/entities/service.entity';
import { EntityManager } from '@mikro-orm/core';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from '@payments/payments.service';
import { Tenant } from '@tenancy/entities/tenant.entity';

import { CommerceService } from './commerce.service';
import { SaleOrder, SaleOrderFulfillment, SaleOrderState } from './entities/sale-order.entity';

const noopPayments = { startCheckout: jest.fn() } as unknown as PaymentsService;

// Regression: previously `commerce.service.ts` shared a module-level
// `NO_TENANT_FILTER = { filters: { tenant: false } }` object across every
// MikroORM call. MikroORM mutates the `options` object it receives —
// it sets `populate`, `loggerContext`, `populateWhere` on it. After
// `createBooking`'s `em.findOne(Service, ..., NO_TENANT_FILTER)` call mutated
// the shared constant to include `populate: []`, the next `listMyOrders`
// spread `...NO_TENANT_FILTER` AFTER `populate: ['service','staff']`, so the
// empty populate from the polluted constant overwrote the real hint —
// and the response silently dropped `service_name` / `professional_name`.
describe('CommerceService — populate option leak guard', () => {
  it('listMyOrders sends populate: [service, staff] to findAndCount even after a prior createBooking attempt has run em.findOne with the tenant filter', async () => {
    const findAndCountOptions: Array<Record<string, unknown>> = [];

    const mutateLikeMikroOrm = (options?: Record<string, unknown>) => {
      if (!options) return;
      options.populate = [];
      options.loggerContext = { id: 1 };
      options.populateWhere = {};
    };

    const fakeEm: Record<string, unknown> = {
      findAndCount: jest.fn((_e: unknown, _w: unknown, options: Record<string, unknown>) => {
        findAndCountOptions.push({ ...options });
        mutateLikeMikroOrm(options);
        return Promise.resolve([[], 0]);
      }),
      findOne: jest.fn((entity: unknown, _w: unknown, options?: Record<string, unknown>) => {
        // Tenant exists so createBooking proceeds past the shop_slug check;
        // Customer lookup returns truthy so we reach the service lookup;
        // Service lookup throws to abort, but only AFTER findOne has had a
        // chance to mutate any shared options reference.
        mutateLikeMikroOrm(options);
        if (entity === Tenant) return Promise.resolve({} as Tenant);
        if (entity === Service) return Promise.resolve(null);
        return Promise.resolve({ id: 'customer-1' });
      }),
    };
    fakeEm.transactional = jest.fn((cb: (em: unknown) => Promise<unknown>) => cb(fakeEm));

    const service = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);

    await expect(
      service.createBooking('tenant-1', 'customer-1', {
        shop_slug: 'demo',
        service_id: 'svc-1',
        date: '2026-01-01',
        start_time: '12:00',
      }),
    ).rejects.toThrow(/not found/i);

    await service.listMyOrders('tenant-1', 'customer-1', {});

    expect(findAndCountOptions).toHaveLength(1);
    expect(findAndCountOptions[0].populate).toEqual([
      'service',
      'staff',
      'items',
      'items.assigned_staff',
    ]);
    expect(findAndCountOptions[0].filters).toEqual({ tenant: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// State transition helpers
// ─────────────────────────────────────────────────────────────────────────────

interface FakeEm {
  findOne: jest.Mock;
  flush: jest.Mock;
}

function makeOrder(state: SaleOrderState): SaleOrder {
  const o = new SaleOrder();
  o.state = state;
  o.fulfillment = SaleOrderFulfillment.APPOINTMENT;
  o.customer = { id: 'customer-1' } as never;
  return o;
}

function makeEm(order: SaleOrder | null): FakeEm {
  return {
    findOne: jest.fn().mockResolvedValue(order),
    flush: jest.fn().mockResolvedValue(undefined),
  };
}

describe('CommerceService — assertTransition', () => {
  const service = new CommerceService(
    { findOne: jest.fn(), flush: jest.fn() } as unknown as EntityManager,
    noopPayments,
  );

  it('does not throw when current state matches required from-state', () => {
    const order = makeOrder(SaleOrderState.CONFIRMED);
    expect(() =>
      service.assertTransition(order, SaleOrderState.CONFIRMED, SaleOrderState.CHECKED_IN),
    ).not.toThrow();
  });

  it('throws ConflictException when state does not match', () => {
    const order = makeOrder(SaleOrderState.PENDING_PAYMENT);
    expect(() =>
      service.assertTransition(order, SaleOrderState.CONFIRMED, SaleOrderState.CHECKED_IN),
    ).toThrow(ConflictException);
  });
});

describe('CommerceService — checkIn', () => {
  it('transitions confirmed → checked_in and sets checked_in_at', async () => {
    const order = makeOrder(SaleOrderState.CONFIRMED);
    const fakeEm = makeEm(order);
    const svc = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);

    const result = await svc.checkIn('tenant-1', 'user-1', 'order-1');

    expect(order.state).toBe(SaleOrderState.CHECKED_IN);
    expect(order.checked_in_at).toBeInstanceOf(Date);
    expect(fakeEm.flush).toHaveBeenCalled();
    expect(result.state).toBe(SaleOrderState.CHECKED_IN);
  });

  it('throws NotFoundException when order does not exist', async () => {
    const fakeEm = makeEm(null);
    const svc = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);
    await expect(svc.checkIn('tenant-1', 'user-1', 'order-1')).rejects.toThrow(NotFoundException);
  });

  it('throws ConflictException when order is not in confirmed state', async () => {
    const order = makeOrder(SaleOrderState.CHECKED_IN);
    const fakeEm = makeEm(order);
    const svc = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);
    await expect(svc.checkIn('tenant-1', 'user-1', 'order-1')).rejects.toThrow(ConflictException);
  });

  it('throws ConflictException for pending_payment state', async () => {
    const order = makeOrder(SaleOrderState.PENDING_PAYMENT);
    const fakeEm = makeEm(order);
    const svc = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);
    await expect(svc.checkIn('tenant-1', 'user-1', 'order-1')).rejects.toThrow(ConflictException);
  });
});

describe('CommerceService — start', () => {
  it('transitions checked_in → in_progress and sets started_at', async () => {
    const order = makeOrder(SaleOrderState.CHECKED_IN);
    const fakeEm = makeEm(order);
    const svc = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);

    const result = await svc.start('tenant-1', 'user-1', 'order-1');

    expect(order.state).toBe(SaleOrderState.IN_PROGRESS);
    expect(order.started_at).toBeInstanceOf(Date);
    expect(fakeEm.flush).toHaveBeenCalled();
    expect(result.state).toBe(SaleOrderState.IN_PROGRESS);
  });

  it('throws NotFoundException when order does not exist', async () => {
    const fakeEm = makeEm(null);
    const svc = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);
    await expect(svc.start('tenant-1', 'user-1', 'order-1')).rejects.toThrow(NotFoundException);
  });

  it('throws ConflictException when order is not in checked_in state', async () => {
    const order = makeOrder(SaleOrderState.CONFIRMED);
    const fakeEm = makeEm(order);
    const svc = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);
    await expect(svc.start('tenant-1', 'user-1', 'order-1')).rejects.toThrow(ConflictException);
  });
});

describe('CommerceService — complete', () => {
  it('transitions in_progress → pending_checkout and sets completed_service_at', async () => {
    const order = makeOrder(SaleOrderState.IN_PROGRESS);
    const fakeEm = makeEm(order);
    const svc = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);

    const result = await svc.complete('tenant-1', 'user-1', 'order-1');

    expect(order.state).toBe(SaleOrderState.PENDING_CHECKOUT);
    expect(order.completed_service_at).toBeInstanceOf(Date);
    expect(fakeEm.flush).toHaveBeenCalled();
    expect(result.state).toBe(SaleOrderState.PENDING_CHECKOUT);
  });

  it('throws NotFoundException when order does not exist', async () => {
    const fakeEm = makeEm(null);
    const svc = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);
    await expect(svc.complete('tenant-1', 'user-1', 'order-1')).rejects.toThrow(NotFoundException);
  });

  it('throws ConflictException when order is not in in_progress state', async () => {
    const order = makeOrder(SaleOrderState.CHECKED_IN);
    const fakeEm = makeEm(order);
    const svc = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);
    await expect(svc.complete('tenant-1', 'user-1', 'order-1')).rejects.toThrow(ConflictException);
  });
});

describe('CommerceService — noShow', () => {
  it('transitions confirmed → no_show and sets no_show_at', async () => {
    const order = makeOrder(SaleOrderState.CONFIRMED);
    const fakeEm = makeEm(order);
    const svc = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);

    const result = await svc.noShow('tenant-1', 'user-1', 'order-1');

    expect(order.state).toBe(SaleOrderState.NO_SHOW);
    expect(order.no_show_at).toBeInstanceOf(Date);
    expect(fakeEm.flush).toHaveBeenCalled();
    expect(result.state).toBe(SaleOrderState.NO_SHOW);
  });

  it('throws NotFoundException when order does not exist', async () => {
    const fakeEm = makeEm(null);
    const svc = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);
    await expect(svc.noShow('tenant-1', 'user-1', 'order-1')).rejects.toThrow(NotFoundException);
  });

  it('throws ConflictException when order is not in confirmed state', async () => {
    const order = makeOrder(SaleOrderState.IN_PROGRESS);
    const fakeEm = makeEm(order);
    const svc = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);
    await expect(svc.noShow('tenant-1', 'user-1', 'order-1')).rejects.toThrow(ConflictException);
  });
});

describe('CommerceService — cancelOrder authorization', () => {
  function makeCancelableOrder(): SaleOrder {
    const o = makeOrder(SaleOrderState.CONFIRMED);
    o.customer = { id: 'customer-1' } as never;
    return o;
  }

  it('allows the owning customer to cancel', async () => {
    const order = makeCancelableOrder();
    const fakeEm = makeEm(order);
    const svc = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);

    await svc.cancelOrder('tenant-1', 'customer-1', ['customer'], 'order-1', {
      reason: 'changed mind',
    });

    expect(order.state).toBe(SaleOrderState.CANCELLED);
    expect(fakeEm.flush).toHaveBeenCalled();
  });

  it('rejects a different customer with ForbiddenException', async () => {
    const order = makeCancelableOrder();
    const fakeEm = makeEm(order);
    const svc = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);

    await expect(
      svc.cancelOrder('tenant-1', 'customer-2', ['customer'], 'order-1', { reason: 'x' }),
    ).rejects.toThrow(ForbiddenException);
    expect(order.state).toBe(SaleOrderState.CONFIRMED);
  });

  it('allows a receptionist (ta role) to cancel any order in the tenant', async () => {
    const order = makeCancelableOrder();
    const fakeEm = makeEm(order);
    const svc = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);

    await svc.cancelOrder('tenant-1', 'receptionist-1', ['ta'], 'order-1', { reason: 'no-show' });

    expect(order.state).toBe(SaleOrderState.CANCELLED);
  });

  it('allows an owner to cancel any order in the tenant', async () => {
    const order = makeCancelableOrder();
    const fakeEm = makeEm(order);
    const svc = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);

    await svc.cancelOrder('tenant-1', 'owner-1', ['owner'], 'order-1', { reason: 'manual' });

    expect(order.state).toBe(SaleOrderState.CANCELLED);
  });
});

describe('CommerceService — rescheduleOrder authorization', () => {
  function makeReschedulableOrder(): SaleOrder {
    const o = makeOrder(SaleOrderState.CONFIRMED);
    o.customer = { id: 'customer-1' } as never;
    o.service = { duration_minutes: 30 } as never;
    return o;
  }

  function makeRescheduleEm(order: SaleOrder | null) {
    const execute = jest.fn().mockResolvedValue(undefined);
    const em = {
      findOne: jest.fn().mockResolvedValue(order),
      flush: jest.fn().mockResolvedValue(undefined),
      getConnection: jest.fn().mockReturnValue({ execute }),
    };
    return { em, execute };
  }

  const dto = { new_datetime: '2026-06-10T14:00:00.000Z' };

  it('allows the owning customer to reschedule', async () => {
    const order = makeReschedulableOrder();
    const { em, execute } = makeRescheduleEm(order);
    const svc = new CommerceService(em as unknown as EntityManager, noopPayments);

    await svc.rescheduleOrder('tenant-1', 'customer-1', ['customer'], 'order-1', dto);

    expect(execute).toHaveBeenCalled();
    expect(order.scheduled_at).toBeInstanceOf(Date);
  });

  it('rejects a different customer with ForbiddenException', async () => {
    const order = makeReschedulableOrder();
    const { em, execute } = makeRescheduleEm(order);
    const svc = new CommerceService(em as unknown as EntityManager, noopPayments);

    await expect(
      svc.rescheduleOrder('tenant-1', 'customer-2', ['customer'], 'order-1', dto),
    ).rejects.toThrow(ForbiddenException);
    expect(execute).not.toHaveBeenCalled();
  });

  it('allows a receptionist (ta role) to reschedule any order in the tenant', async () => {
    const order = makeReschedulableOrder();
    const { em, execute } = makeRescheduleEm(order);
    const svc = new CommerceService(em as unknown as EntityManager, noopPayments);

    await svc.rescheduleOrder('tenant-1', 'receptionist-1', ['ta'], 'order-1', dto);

    expect(execute).toHaveBeenCalled();
    expect(order.scheduled_at).toBeInstanceOf(Date);
  });

  it('allows an owner to reschedule any order in the tenant', async () => {
    const order = makeReschedulableOrder();
    const { em, execute } = makeRescheduleEm(order);
    const svc = new CommerceService(em as unknown as EntityManager, noopPayments);

    await svc.rescheduleOrder('tenant-1', 'owner-1', ['owner'], 'order-1', dto);

    expect(execute).toHaveBeenCalled();
  });
});

describe('CommerceService — full happy-path flow', () => {
  it('confirmed → checked_in → in_progress → pending_checkout', async () => {
    const order = makeOrder(SaleOrderState.CONFIRMED);
    const fakeEm = makeEm(order);
    const svc = new CommerceService(fakeEm as unknown as EntityManager, noopPayments);

    await svc.checkIn('tenant-1', 'user-1', 'order-1');
    expect(order.state).toBe(SaleOrderState.CHECKED_IN);

    await svc.start('tenant-1', 'user-1', 'order-1');
    expect(order.state).toBe(SaleOrderState.IN_PROGRESS);

    await svc.complete('tenant-1', 'user-1', 'order-1');
    expect(order.state).toBe(SaleOrderState.PENDING_CHECKOUT);

    expect(order.checked_in_at).toBeInstanceOf(Date);
    expect(order.started_at).toBeInstanceOf(Date);
    expect(order.completed_service_at).toBeInstanceOf(Date);
  });
});
