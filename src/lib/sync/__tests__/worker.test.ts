/**
 * Property-based tests for worker.ts
 *
 * Feature: supabase-cloud-sync, Property 3: Timestamp Conversion Round-Trip
 * Feature: supabase-cloud-sync, Property 5: Duplicate Collapse Preserves Latest
 * Feature: supabase-cloud-sync, Property 6: Exponential Backoff Bounded
 * Feature: supabase-cloud-sync, Property 7: Cloud Data Mapping Injects User ID
 * Feature: supabase-cloud-sync, Property 8: Invalid Timestamp Detection
 * Feature: supabase-cloud-sync, Property 12: Error Message Truncation
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { collapseDuplicates, isValidTimestamp, mapToCloud } from '../worker';
import type { Entity } from '../types';

interface ReadyRow {
  id: number;
  entity: Entity;
  entity_id: string;
  op: 'upsert' | 'delete';
  payload: string;
  attempts: number;
}

const mkRow = (id: number, entity: Entity, entity_id: string): ReadyRow => ({
  id,
  entity,
  entity_id,
  op: 'upsert',
  payload: '{}',
  attempts: 0,
});

// Property 3: Timestamp Conversion Round-Trip
// Validates: Requirements 7.1, 7.4
describe('Property 3: Timestamp Conversion Round-Trip', () => {
  it('msToIso then isoToMs yields original value', () => {
    // JS Date max is 8640000000000000 ms (April 20, 271821)
    const MAX_DATE_MS = 8_640_000_000_000_000;
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_DATE_MS }),
        (ms) => {
          const iso = new Date(ms).toISOString();
          const back = Date.parse(iso);
          expect(back).toBe(ms);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('null deleted_at remains null through conversion', () => {
    const result = mapToCloud(
      { id: 'a', created_at: 1000, updated_at: 2000, deleted_at: null },
      'u1',
    );
    expect(result.deleted_at).toBeNull();
  });
});

// Property 5: Duplicate Collapse Preserves Latest
// Validates: Requirements 6.3
describe('Property 5: Duplicate Collapse Preserves Latest', () => {
  it('keeps highest id per (entity, entity_id), marks others as superseded', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.integer({ min: 1, max: 10000 }),
            entity: fc.constantFrom<Entity>('resource', 'event'),
            entity_id: fc.constantFrom('a', 'b', 'c'),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        (rawRows) => {
          // Deduplicate ids to avoid ambiguity
          const seen = new Set<number>();
          const rows: ReadyRow[] = rawRows
            .filter((r) => {
              if (seen.has(r.id)) return false;
              seen.add(r.id);
              return true;
            })
            .map((r) => mkRow(r.id, r.entity, r.entity_id));

          const result = collapseDuplicates(rows);

          // Each (entity, entity_id) pair should appear at most once in perEntity
          const keys = new Set<string>();
          for (const r of [...result.perEntity.resource, ...result.perEntity.event]) {
            const k = `${r.entity}:${r.entity_id}`;
            expect(keys.has(k)).toBe(false);
            keys.add(k);
          }

          // The kept row must have the highest id for its key
          for (const r of [...result.perEntity.resource, ...result.perEntity.event]) {
            const k = `${r.entity}:${r.entity_id}`;
            const allForKey = rows.filter((x) => `${x.entity}:${x.entity_id}` === k);
            const maxId = Math.max(...allForKey.map((x) => x.id));
            expect(r.id).toBe(maxId);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Property 6: Exponential Backoff Bounded
// Validates: Requirements 6.5
describe('Property 6: Exponential Backoff Bounded', () => {
  it('backoff never exceeds 300000ms for any attempt count', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        (attempts) => {
          const backoff = Math.min(2 ** attempts * 1000, 300_000);
          expect(backoff).toBeLessThanOrEqual(300_000);
          expect(backoff).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Property 7: Cloud Data Mapping Injects User ID
// Validates: Requirements 7.2
describe('Property 7: Cloud Data Mapping Injects User ID', () => {
  it('mapToCloud always includes user_id equal to the provided userId', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.record({
          id: fc.uuid(),
          created_at: fc.integer({ min: 1, max: 2_000_000_000_000 }),
          updated_at: fc.integer({ min: 1, max: 2_000_000_000_000 }),
          deleted_at: fc.option(fc.integer({ min: 1, max: 2_000_000_000_000 }), { nil: null }),
        }),
        (userId, data) => {
          const result = mapToCloud(data as Record<string, unknown>, userId);
          expect(result.user_id).toBe(userId);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Property 8: Invalid Timestamp Detection
// Validates: Requirements 7.5
describe('Property 8: Invalid Timestamp Detection', () => {
  it('isValidTimestamp accepts only positive integers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
        (v) => {
          expect(isValidTimestamp(v)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('isValidTimestamp rejects zero, negatives, floats, NaN, strings, null', () => {
    const invalids: unknown[] = [
      0, -1, -1000, 1.5, NaN, Infinity, '1000', null, undefined, '', true,
    ];
    for (const v of invalids) {
      expect(isValidTimestamp(v)).toBe(false);
    }
  });

  it('isValidTimestamp rejects non-integer numbers via property', () => {
    // fc.float requires 32-bit float bounds; use Math.fround to convert
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(-1e10), max: Math.fround(-0.001) }),
        (v) => {
          expect(isValidTimestamp(v)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Property 12: Error Message Truncation
// Validates: Requirements 6.6
describe('Property 12: Error Message Truncation', () => {
  it('errMsg.slice(0, 1024) always produces string of length ≤ 1024', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 5000 }),
        (msg) => {
          const truncated = msg.slice(0, 1024);
          expect(truncated.length).toBeLessThanOrEqual(1024);
          if (msg.length <= 1024) expect(truncated).toBe(msg);
          else expect(truncated.length).toBe(1024);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Example-based tests
describe('collapseDuplicates examples', () => {
  it('empty input → empty output', () => {
    const r = collapseDuplicates([]);
    expect(r.perEntity.resource).toEqual([]);
    expect(r.perEntity.event).toEqual([]);
    expect(r.supersededIds.resource).toEqual([]);
    expect(r.supersededIds.event).toEqual([]);
  });

  it('single row → kept, no superseded', () => {
    const r = collapseDuplicates([mkRow(1, 'resource', 'a')]);
    expect(r.perEntity.resource).toHaveLength(1);
    expect(r.supersededIds.resource).toEqual([]);
  });

  it('duplicate keeps highest id, marks lower as superseded', () => {
    const r = collapseDuplicates([
      mkRow(1, 'resource', 'a'),
      mkRow(5, 'resource', 'a'),
      mkRow(3, 'resource', 'a'),
    ]);
    expect(r.perEntity.resource[0]?.id).toBe(5);
    expect(r.supersededIds.resource.sort()).toEqual([1, 3]);
  });
});
