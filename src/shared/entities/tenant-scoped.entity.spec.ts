import { Entity, MikroORM, Property } from '@mikro-orm/core';
import { SqliteDriver } from '@mikro-orm/sqlite';

import { TenantScopedEntity } from './tenant-scoped.entity';

@Entity()
class TenantItem extends TenantScopedEntity {
  @Property()
  name!: string;
}

async function createOrm() {
  return MikroORM.init<SqliteDriver>({
    driver: SqliteDriver,
    dbName: ':memory:',
    entities: [TenantItem],
    allowGlobalContext: true,
  });
}

describe('TenantScopedEntity — structure', () => {
  it('has a tenant_id property', () => {
    const item = new TenantItem();
    expect('tenant_id' in item).toBe(true);
  });
});

describe('TenantScopedEntity — tenant filter (integration)', () => {
  let orm: Awaited<ReturnType<typeof createOrm>>;

  beforeAll(async () => {
    orm = await createOrm();
    // Create schema manually; defaultRaw: 'now()' is PostgreSQL syntax not supported by SQLite
    await orm.em.getConnection().execute(
      `CREATE TABLE tenant_item (
          id TEXT PRIMARY KEY,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          tenant_id TEXT NOT NULL,
          name TEXT NOT NULL
        )`,
    );

    // Seed two tenants
    const em = orm.em.fork();
    const itemA = em.create(TenantItem, { tenant_id: 'tenant-a', name: 'Alpha' });
    const itemB = em.create(TenantItem, { tenant_id: 'tenant-b', name: 'Beta' });
    await em.persistAndFlush([itemA, itemB]);
  });

  afterAll(async () => {
    await orm.close();
  });

  it('GIVEN tenant filter param set WHEN querying THEN only matching tenant records are returned', async () => {
    const em = orm.em.fork();
    em.setFilterParams('tenant', { tenantId: 'tenant-a' });

    const results = await em.find(TenantItem, {});
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Alpha');
    expect(results[0].tenant_id).toBe('tenant-a');
  });

  it('GIVEN tenant filter explicitly disabled WHEN querying THEN all records are returned', async () => {
    const em = orm.em.fork();

    const results = await em.find(TenantItem, {}, { filters: { tenant: false } });
    expect(results).toHaveLength(2);
  });

  it('GIVEN different tenant param WHEN querying THEN only that tenant records are returned', async () => {
    const em = orm.em.fork();
    em.setFilterParams('tenant', { tenantId: 'tenant-b' });

    const results = await em.find(TenantItem, {});
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Beta');
  });
});
