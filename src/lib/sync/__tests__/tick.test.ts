import { describe, it, expect } from 'vitest';
import { collapseDuplicates, isValidTimestamp, mapToCloud } from '../worker';
import type { Entity } from '../types';

interface ReadyRow {
  id: number; entity: Entity; entity_id: string;
  op: 'upsert' | 'delete'; payload: string; attempts: number;
}

const mkRow = (id: number, entity: Entity, entity_id: string): ReadyRow => ({
  id, entity, entity_id, op: 'upsert', payload: '{}', attempts: 0,
});

describe('tick guard: collapseDuplicates', () => {
  it('keeps latest per (entity, entity_id) across many rows', () => {
    const rows: ReadyRow[] = [];
    for (let i = 1; i <= 20; i++) {
      rows.push(mkRow(i, 'resource', 'x'));
    }
    const r = collapseDuplicates(rows);
    expect(r.perEntity.resource).toHaveLength(1);
    expect(r.perEntity.resource[0]?.id).toBe(20);
    expect(r.supersededIds.resource).toHaveLength(19);
  });

  it('partial failure: resource and event superseded tracked independently', () => {
    const rows: ReadyRow[] = [
      mkRow(1, 'resource', 'a'),
      mkRow(2, 'resource', 'a'),
      mkRow(3, 'event', 'b'),
      mkRow(4, 'event', 'b'),
    ];
    const r = collapseDuplicates(rows);
    expect(r.perEntity.resource[0]?.id).toBe(2);
    expect(r.perEntity.event[0]?.id).toBe(4);
    expect(r.supersededIds.resource).toEqual([1]);
    expect(r.supersededIds.event).toEqual([3]);
  });
});

describe('tick guard: timestamp validation', () => {
  it('isValidTimestamp rejects zero', () => expect(isValidTimestamp(0)).toBe(false));
  it('isValidTimestamp rejects negative', () => expect(isValidTimestamp(-1)).toBe(false));
  it('isValidTimestamp rejects float', () => expect(isValidTimestamp(1.5)).toBe(false));
  it('isValidTimestamp rejects NaN', () => expect(isValidTimestamp(NaN)).toBe(false));
  it('isValidTimestamp rejects string', () => expect(isValidTimestamp('1000')).toBe(false));
  it('isValidTimestamp accepts positive integer', () => expect(isValidTimestamp(1700000000000)).toBe(true));
});

describe('tick guard: mapToCloud', () => {
  it('converts ms timestamps to ISO strings', () => {
    const r = mapToCloud({ id: 'a', created_at: 1700000000000, updated_at: 1700000000000, deleted_at: null }, 'u1');
    expect(r.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.deleted_at).toBeNull();
    expect(r.user_id).toBe('u1');
  });

  it('converts non-null deleted_at to ISO', () => {
    const r = mapToCloud({ id: 'a', created_at: 1, updated_at: 1, deleted_at: 1700000000000 }, 'u1');
    expect(typeof r.deleted_at).toBe('string');
  });
});
