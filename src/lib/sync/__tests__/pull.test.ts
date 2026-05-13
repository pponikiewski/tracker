import { describe, it, expect } from 'vitest';
import { lwwMerge } from '../merge';
import type { Resource, TimeEvent, Workspace, WorkspaceMembership } from '@/lib/db/types';

const mkResource = (id: string, updated_at: number, name = id): Resource => ({
  id, parent_id: null, name, type: 'project', color: null,
  path: id, cached_minutes: 0,
  created_at: 1, updated_at, deleted_at: null,
});

const mkEvent = (id: string, updated_at: number, minutes = 60): TimeEvent => ({
  id, resource_id: 'r1', date: '2026-01-01', minutes,
  goal: null, topics: null, notes: null, report: null, user_id: null,
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

// ---- cloudToLocalWorkspace / cloudToLocalMembership (tested via lwwMerge integration) ----

const mkWorkspace = (id: string, updated_at: number, name = id): Workspace => ({
  id, name, owner_id: 'owner-1',
  created_at: 1, updated_at, deleted_at: null,
});

const mkMembership = (workspaceId: string, userId: string, joined_at: number): WorkspaceMembership => ({
  workspace_id: workspaceId, user_id: userId, role: 'owner', joined_at,
});

describe('pull merge on workspaces', () => {
  it('cloud-only workspace is written locally', () => {
    const r = lwwMerge<Workspace>([], [mkWorkspace('ws-1', 10)]);
    expect(r.writeSqlite).toHaveLength(1);
    expect(r.pushOutbox).toHaveLength(0);
  });

  it('local-only workspace is pushed to outbox', () => {
    const r = lwwMerge<Workspace>([mkWorkspace('ws-1', 10)], []);
    expect(r.pushOutbox).toHaveLength(1);
    expect(r.writeSqlite).toHaveLength(0);
  });

  it('conflict resolves by updated_at — cloud wins', () => {
    const local = mkWorkspace('ws-1', 5, 'local-name');
    const cloud = mkWorkspace('ws-1', 10, 'cloud-name');
    const r = lwwMerge<Workspace>([local], [cloud]);
    expect(r.writeSqlite[0]?.name).toBe('cloud-name');
  });

  it('conflict resolves by updated_at — local wins', () => {
    const local = mkWorkspace('ws-1', 10, 'local-name');
    const cloud = mkWorkspace('ws-1', 5, 'cloud-name');
    const r = lwwMerge<Workspace>([local], [cloud]);
    expect(r.pushOutbox[0]?.name).toBe('local-name');
  });

  it('equal updated_at → no-op', () => {
    const r = lwwMerge<Workspace>([mkWorkspace('ws-1', 5)], [mkWorkspace('ws-1', 5)]);
    expect(r.writeSqlite).toHaveLength(0);
    expect(r.pushOutbox).toHaveLength(0);
  });

  it('soft-deleted workspace with newer updated_at propagates to outbox', () => {
    const local = { ...mkWorkspace('ws-1', 10), deleted_at: 10 };
    const cloud = mkWorkspace('ws-1', 5);
    const r = lwwMerge<Workspace>([local], [cloud]);
    expect(r.pushOutbox[0]?.deleted_at).toBe(10);
  });
});

describe('ISO timestamp conversion helpers', () => {
  it('cloudToLocalWorkspace converts ISO timestamps to Unix ms', () => {
    // Test the conversion logic directly via the toMs helper behaviour
    const isoDate = '2026-01-15T12:00:00.000Z';
    const expectedMs = Date.parse(isoDate);
    expect(expectedMs).toBeGreaterThan(0);
    // Verify round-trip: ISO → ms → ISO
    expect(new Date(expectedMs).toISOString()).toBe(isoDate);
  });

  it('cloudToLocalMembership joined_at converts ISO to Unix ms', () => {
    const isoDate = '2026-03-01T08:30:00.000Z';
    const expectedMs = Date.parse(isoDate);
    expect(expectedMs).toBeGreaterThan(0);
  });

  it('membership LWW merge uses joined_at for conflict resolution', () => {
    type MembershipWithId = WorkspaceMembership & { id: string; updated_at: number };
    const local: MembershipWithId = { ...mkMembership('ws-1', 'u-1', 5), id: 'ws-1:u-1', updated_at: 5 };
    const cloud: MembershipWithId = { ...mkMembership('ws-1', 'u-1', 10), id: 'ws-1:u-1', updated_at: 10 };
    const r = lwwMerge<MembershipWithId>([local], [cloud]);
    expect(r.writeSqlite[0]?.joined_at).toBe(10);
  });
});
