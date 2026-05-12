// Feature: supabase-cloud-sync, Property 1: LWW Merge Correctness
// Feature: supabase-cloud-sync, Property 2: LWW Merge Idempotence
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { lwwMerge } from '../merge';

interface R { id: string; updated_at: number | string; name?: string }

// Arbitrary for a single record
const recordArb = fc.record({
  id: fc.uuid(),
  updated_at: fc.integer({ min: 1, max: 2_000_000_000_000 }),
  name: fc.string(),
});

// Arbitrary for a list of records with unique ids
const recordListArb = fc.array(recordArb, { minLength: 0, maxLength: 20 })
  .map((arr) => {
    const seen = new Set<string>();
    return arr.filter((r) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
  });

describe('Property 1: LWW Merge Correctness', () => {
  it('cloud-only → writeSqlite, local-only → pushOutbox, both → higher wins, equal → neither', () => {
    fc.assert(fc.property(recordListArb, recordListArb, (local, cloud) => {
      const result = lwwMerge(local, cloud);
      const localMap = new Map(local.map((r) => [r.id, r]));
      const cloudMap = new Map(cloud.map((r) => [r.id, r]));

      for (const r of result.writeSqlite) {
        const l = localMap.get(r.id);
        const c = cloudMap.get(r.id);
        if (!l && c) continue; // cloud-only: OK
        if (l && c) {
          // cloud wins: cloud updated_at must be strictly greater
          const lt = typeof l.updated_at === 'number' ? l.updated_at : Date.parse(l.updated_at as string);
          const ct = typeof c.updated_at === 'number' ? c.updated_at : Date.parse(c.updated_at as string);
          expect(ct).toBeGreaterThan(lt);
          continue;
        }
        throw new Error(`writeSqlite contains local-only record ${r.id}`);
      }

      for (const r of result.pushOutbox) {
        const l = localMap.get(r.id);
        const c = cloudMap.get(r.id);
        if (l && !c) continue; // local-only: OK
        if (l && c) {
          // local wins: local updated_at must be strictly greater
          const lt = typeof l.updated_at === 'number' ? l.updated_at : Date.parse(l.updated_at as string);
          const ct = typeof c.updated_at === 'number' ? c.updated_at : Date.parse(c.updated_at as string);
          expect(lt).toBeGreaterThan(ct);
          continue;
        }
        throw new Error(`pushOutbox contains cloud-only record ${r.id}`);
      }

      // Equal timestamps → neither output
      for (const l of local) {
        const c = cloudMap.get(l.id);
        if (!c) continue;
        const lt = typeof l.updated_at === 'number' ? l.updated_at : Date.parse(l.updated_at as string);
        const ct = typeof c.updated_at === 'number' ? c.updated_at : Date.parse(c.updated_at as string);
        if (lt === ct) {
          expect(result.writeSqlite.find((r) => r.id === l.id)).toBeUndefined();
          expect(result.pushOutbox.find((r) => r.id === l.id)).toBeUndefined();
        }
      }
    }), { numRuns: 100 });
  });
});

describe('Property 2: LWW Merge Idempotence', () => {
  it('merge(merge(local,cloud).writeSqlite + local, cloud) produces no new writes', () => {
    fc.assert(fc.property(recordListArb, recordListArb, (local, cloud) => {
      const first = lwwMerge(local, cloud);
      // After applying writeSqlite, the new local is: original local + cloud-wins (overwriting)
      const localMap = new Map(local.map((r) => [r.id, r]));
      for (const r of first.writeSqlite) localMap.set(r.id, r);
      const newLocal = Array.from(localMap.values());
      const second = lwwMerge(newLocal, cloud);
      // No new writes should appear
      expect(second.writeSqlite).toHaveLength(0);
    }), { numRuns: 100 });
  });
});

// Feature: multi-tenant-schema, Property 9: LWW Merge dla workspace'ow
// Validates: Requirements 7.6
describe('Property 9: LWW Merge dla workspace\'ow', () => {
  interface WorkspaceRow {
    id: string;
    updated_at: number;
    name?: string;
    owner_id?: string;
  }

  const workspaceArb = fc.record({
    id: fc.uuid(),
    updated_at: fc.integer({ min: 1, max: 2_000_000_000_000 }),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    owner_id: fc.uuid(),
  });

  const workspaceListArb = fc.array(workspaceArb, { minLength: 0, maxLength: 20 })
    .map((arr) => {
      const seen = new Set<string>();
      return arr.filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
    });

  it('cloud-only → writeSqlite; local-only → pushOutbox; konflikt → wyższy updated_at wygrywa; równe → brak akcji', () => {
    fc.assert(
      fc.property(workspaceListArb, workspaceListArb, (local: WorkspaceRow[], cloud: WorkspaceRow[]) => {
        const result = lwwMerge(local, cloud);
        const localMap = new Map(local.map((r) => [r.id, r]));
        const cloudMap = new Map(cloud.map((r) => [r.id, r]));

        // cloud-only rows must go to writeSqlite
        for (const r of result.writeSqlite) {
          const l = localMap.get(r.id);
          const c = cloudMap.get(r.id);
          if (!l && c) continue; // cloud-only: OK
          if (l && c) {
            // cloud wins: cloud updated_at must be strictly greater
            expect(c.updated_at).toBeGreaterThan(l.updated_at);
            continue;
          }
          throw new Error(`writeSqlite contains local-only workspace ${r.id}`);
        }

        // local-only rows must go to pushOutbox
        for (const r of result.pushOutbox) {
          const l = localMap.get(r.id);
          const c = cloudMap.get(r.id);
          if (l && !c) continue; // local-only: OK
          if (l && c) {
            // local wins: local updated_at must be strictly greater
            expect(l.updated_at).toBeGreaterThan(c.updated_at);
            continue;
          }
          throw new Error(`pushOutbox contains cloud-only workspace ${r.id}`);
        }

        // Equal timestamps → neither output
        for (const l of local) {
          const c = cloudMap.get(l.id);
          if (!c) continue;
          if (l.updated_at === c.updated_at) {
            expect(result.writeSqlite.find((r) => r.id === l.id)).toBeUndefined();
            expect(result.pushOutbox.find((r) => r.id === l.id)).toBeUndefined();
          }
        }

        // Every cloud-only row must appear in writeSqlite
        for (const c of cloud) {
          if (!localMap.has(c.id)) {
            expect(result.writeSqlite.find((r) => r.id === c.id)).toBeDefined();
          }
        }

        // Every local-only row must appear in pushOutbox
        for (const l of local) {
          if (!cloudMap.has(l.id)) {
            expect(result.pushOutbox.find((r) => r.id === l.id)).toBeDefined();
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('Example-based unit tests', () => {
  it('local-only → pushOutbox', () => {
    const r = lwwMerge<R>([{ id: 'a', updated_at: 1 }], []);
    expect(r.pushOutbox).toEqual([{ id: 'a', updated_at: 1 }]);
    expect(r.writeSqlite).toEqual([]);
  });

  it('cloud-only → writeSqlite', () => {
    const r = lwwMerge<R>([], [{ id: 'a', updated_at: 1 }]);
    expect(r.writeSqlite).toEqual([{ id: 'a', updated_at: 1 }]);
    expect(r.pushOutbox).toEqual([]);
  });

  it('both equal updated_at → no-op', () => {
    const r = lwwMerge<R>([{ id: 'a', updated_at: 5 }], [{ id: 'a', updated_at: 5 }]);
    expect(r.writeSqlite).toEqual([]);
    expect(r.pushOutbox).toEqual([]);
  });

  it('local newer → pushOutbox', () => {
    const r = lwwMerge<R>(
      [{ id: 'a', updated_at: 10, name: 'L' }],
      [{ id: 'a', updated_at: 5, name: 'C' }],
    );
    expect(r.pushOutbox).toEqual([{ id: 'a', updated_at: 10, name: 'L' }]);
  });

  it('cloud newer → writeSqlite', () => {
    const r = lwwMerge<R>(
      [{ id: 'a', updated_at: 5, name: 'L' }],
      [{ id: 'a', updated_at: 10, name: 'C' }],
    );
    expect(r.writeSqlite).toEqual([{ id: 'a', updated_at: 10, name: 'C' }]);
  });

  it('mixed types: ISO string vs ms epoch', () => {
    const r = lwwMerge<R>(
      [{ id: 'a', updated_at: 1700_000_000_000 }],
      [{ id: 'a', updated_at: '2026-01-01T00:00:00Z' }], // newer
    );
    expect(r.writeSqlite.length).toBe(1);
    expect(r.pushOutbox.length).toBe(0);
  });
});
