import { Entity } from '@mikro-orm/core';

import { BaseEntity } from './base.entity';

@Entity()
class ConcreteEntity extends BaseEntity {}

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
