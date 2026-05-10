import { Service } from '@catalog/entities/service.entity';
import { EntityManager } from '@mikro-orm/core';
import { PaymentsService } from '@payments/payments.service';
import { Tenant } from '@tenancy/entities/tenant.entity';

import { CommerceService } from './commerce.service';

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
    expect(findAndCountOptions[0].populate).toEqual(['service', 'staff']);
    expect(findAndCountOptions[0].filters).toEqual({ tenant: false });
  });
});
