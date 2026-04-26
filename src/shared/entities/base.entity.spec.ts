import { Entity, MikroORM, Property } from '@mikro-orm/core';
import { SqliteDriver } from '@mikro-orm/sqlite';

import { BaseEntity } from './base.entity';

@Entity()
class ConcreteEntity extends BaseEntity {
  @Property()
  name!: string;
}

describe('BaseEntity', () => {
  it('generates a UUID v7 id on construction', () => {
    const entity = new ConcreteEntity();
    expect(entity.id).toBeDefined();
    expect(typeof entity.id).toBe('string');
    // UUID v7 starts with a timestamp-derived prefix; validate full UUID format
    expect(entity.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('generates unique ids across instances', () => {
    const a = new ConcreteEntity();
    const b = new ConcreteEntity();
    expect(a.id).not.toBe(b.id);
  });

  it('sets created_at to a Date on construction', () => {
    const entity = new ConcreteEntity();
    expect(entity.created_at).toBeInstanceOf(Date);
  });

  it('sets updated_at to a Date on construction', () => {
    const entity = new ConcreteEntity();
    expect(entity.updated_at).toBeInstanceOf(Date);
  });

  it('created_at reflects construction time', () => {
    const before = new Date();
    const entity = new ConcreteEntity();
    const after = new Date();
    expect(entity.created_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(entity.created_at.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

describe('BaseEntity — updated_at onUpdate hook (integration)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init<SqliteDriver>({
      driver: SqliteDriver,
      dbName: ':memory:',
      entities: [ConcreteEntity],
      allowGlobalContext: true,
    });
    await orm.em.getConnection().execute(
      `CREATE TABLE concrete_entity (
        id TEXT PRIMARY KEY,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        name TEXT NOT NULL
      )`,
    );
  });

  afterAll(async () => {
    await orm.close();
  });

  it('updated_at changes after a field is mutated and flushed', async () => {
    const em = orm.em.fork();
    const entity = em.create(ConcreteEntity, { name: 'original' });
    await em.persistAndFlush(entity);
    const createdUpdatedAt = entity.updated_at;

    // Ensure clock advances before the update
    await new Promise((r) => setTimeout(r, 5));

    const em2 = orm.em.fork();
    const loaded = await em2.findOneOrFail(ConcreteEntity, entity.id);
    loaded.name = 'modified';
    await em2.flush();

    expect(loaded.updated_at.getTime()).toBeGreaterThan(createdUpdatedAt.getTime());
  });
});
