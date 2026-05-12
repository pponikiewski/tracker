import { describe, it, expect } from 'vitest';
import { lwwMerge } from '../merge';
import type { Resource, TimeEvent } from '@/lib/db/types';

const mkResource = (id: string, updated_at: number, name = id): Resource => ({
  id, parent_id: null, name, type: 'project', color: null,
  path: id, cached_minutes: 0,
  created_at: 1, updated_at, deleted_at: null,
});

const mkEvent = (id: string, updated_at: number, minutes = 60): TimeEvent => ({
  id, resource_id: 'r1', date: '2026-01-01', minutes,
  goal: null, topics: null, notes: null, report: null,
  created_at: 1, updated_at, deleted_at: null,
});

describe('pull merge on resources', () => {
  it('cloud-only rows are written locally', () => {
    const r = lwwMerge<Resource>([], [mkResource('a', 10)]);
    expect(r.writeSqlite).toHaveLength(1);
    expect(r.pushOutbox).toHaveLength(0);
  });

  it('local-only rows are pushed to outbox', () => {
    const r = lwwMerge<Resource>([mkResource('a', 10)], []);
    expect(r.pushOutbox).toHaveLength(1);
    expect(r.writeSqlite).toHaveLength(0);
  });

  it('conflict resolves by updated_at — cloud wins', () => {
    const local = mkResource('a', 5, 'local-name');
    const cloud = mkResource('a', 10, 'cloud-name');
    const r = lwwMerge<Resource>([local], [cloud]);
    expect(r.writeSqlite[0]?.name).toBe('cloud-name');
  });

  it('conflict resolves by updated_at — local wins', () => {
    const local = mkResource('a', 10, 'local-name');
    const cloud = mkResource('a', 5, 'cloud-name');
    const r = lwwMerge<Resource>([local], [cloud]);
    expect(r.pushOutbox[0]?.name).toBe('local-name');
  });

  it('soft-deleted local with newer updated_at propagates to outbox', () => {
    const local = { ...mkResource('a', 10), deleted_at: 10 };
    const cloud = mkResource('a', 5);
    const r = lwwMerge<Resource>([local], [cloud]);
    expect(r.pushOutbox[0]?.deleted_at).toBe(10);
  });

  it('equal updated_at → no-op', () => {
    const r = lwwMerge<Resource>([mkResource('a', 5)], [mkResource('a', 5)]);
    expect(r.writeSqlite).toHaveLength(0);
    expect(r.pushOutbox).toHaveLength(0);
  });
});

describe('pull merge on events', () => {
  it('handles ms epoch on both sides', () => {
    const r = lwwMerge<TimeEvent>(
      [mkEvent('a', 5, 60)],
      [mkEvent('a', 10, 90)],
    );
    expect(r.writeSqlite[0]?.minutes).toBe(90);
  });

  it('local-only event pushed to outbox', () => {
    const r = lwwMerge<TimeEvent>([mkEvent('a', 5)], []);
    expect(r.pushOutbox).toHaveLength(1);
  });
});
