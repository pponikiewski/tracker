import { describe, it, expect } from 'vitest';
import type { Resource } from '@/lib/db/types';
import { canParent, defaultChildType } from '../types';

describe('canParent — parent→child matrix', () => {
  it('project accepts project, stage, task', () => {
    expect(canParent('project', 'project')).toBe(true);
    expect(canParent('project', 'stage')).toBe(true);
    expect(canParent('project', 'task')).toBe(true);
  });

  it('project rejects substage', () => {
    expect(canParent('project', 'substage')).toBe(false);
  });

  it('stage accepts substage and task only', () => {
    expect(canParent('stage', 'substage')).toBe(true);
    expect(canParent('stage', 'task')).toBe(true);
    expect(canParent('stage', 'project')).toBe(false);
    expect(canParent('stage', 'stage')).toBe(false);
  });

  it('substage accepts task only', () => {
    expect(canParent('substage', 'task')).toBe(true);
    expect(canParent('substage', 'project')).toBe(false);
    expect(canParent('substage', 'stage')).toBe(false);
    expect(canParent('substage', 'substage')).toBe(false);
  });

  it('task accepts task only', () => {
    expect(canParent('task', 'task')).toBe(true);
    expect(canParent('task', 'project')).toBe(false);
    expect(canParent('task', 'stage')).toBe(false);
    expect(canParent('task', 'substage')).toBe(false);
  });
});

describe('defaultChildType', () => {
  it('walks the hierarchy chain', () => {
    expect(defaultChildType('project')).toBe('stage');
    expect(defaultChildType('stage')).toBe('substage');
    expect(defaultChildType('substage')).toBe('task');
  });

  it('task gets a subtask', () => {
    expect(defaultChildType('task')).toBe('task');
  });
});

describe("Resource type", () => {
  it("has completed_at field defaulting to null", () => {
    const r: Resource = {
      id: "x",
      workspace_id: "w",
      parent_id: null,
      name: "test",
      type: "project",
      color: null,
      path: "x",
      cached_minutes: 0,
      created_at: 0,
      updated_at: 0,
      deleted_at: null,
      completed_at: null,
    };
    expect(r.completed_at).toBeNull();
  });

  it("completed_at accepts a timestamp", () => {
    const r: Resource = {
      id: "x",
      workspace_id: "w",
      parent_id: null,
      name: "test",
      type: "project",
      color: null,
      path: "x",
      cached_minutes: 0,
      created_at: 0,
      updated_at: 0,
      deleted_at: null,
      completed_at: 1716220800000,
    };
    expect(r.completed_at).toBe(1716220800000);
  });
});
