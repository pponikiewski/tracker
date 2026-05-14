# Tree Hierarchy Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce strict folder-like nesting rules for the resource tree — project→stage→substage→task hierarchy, task allowed anywhere, project nests only inside project, type fixed at creation.

**Architecture:** Pure validation functions (`canParent`, `defaultChildType`) in `src/lib/db/types.ts` get rewritten with a real parent→child matrix. `moveResource` (`src/lib/db/queries.ts`) stops mutating `type` on move and rejects non-project nodes at root. The drag-drop guard `canDropOn` in `ProjectsView.tsx` tightens the root-drop rule. No DB migration — schema unchanged.

**Tech Stack:** TypeScript 5.8, Vitest 4, React 19, tauri-plugin-sql (SQLite).

---

## File Structure

- `src/lib/db/types.ts` — MODIFY: rewrite `canParent` and `defaultChildType`. Pure functions, no deps.
- `src/lib/db/__tests__/types.test.ts` — CREATE: unit tests for the two pure functions (full matrix). New test dir — first test file for `src/lib/db/`.
- `src/lib/db/queries.ts` — MODIFY: `moveResource` — drop `type` mutation, add non-project-to-root rejection.
- `src/components/ProjectsView.tsx` — MODIFY: `canDropOn` root branch — only `project` may drop at root.

`moveResource` is DB-backed (`tauri-plugin-sql`) and the codebase has no SQLite test harness — `queries.ts` has zero tests today. Its correctness rides on `canParent` (unit-tested here) plus manual verification in `pnpm tauri dev`. We do not add a DB mock harness — out of scope.

---

### Task 1: Rewrite `canParent` and `defaultChildType` with the real matrix

**Files:**
- Modify: `src/lib/db/types.ts:43-64`
- Test: `src/lib/db/__tests__/types.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/db/__tests__/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/db/__tests__/types.test.ts`
Expected: FAIL — `canParent('project','substage')` returns `true` (old rule `parent !== "task"`), `defaultChildType('task')` returns `null`, `defaultChildType('project')` returns `'project'`.

- [ ] **Step 3: Rewrite the two functions**

In `src/lib/db/types.ts`, replace the existing `defaultChildType` (lines 39-54) and `canParent` (lines 56-64) with:

```typescript
/**
 * Allowed children for each parent type.
 * Hierarchy: project → stage → substage → task.
 * - task is a universal leaf-or-branch (allowed under everything, incl. itself)
 * - project nests only inside project (the only way a project becomes a subproject)
 */
const ALLOWED_CHILDREN: Record<ResourceType, ResourceType[]> = {
  project: ['project', 'stage', 'task'],
  stage: ['substage', 'task'],
  substage: ['task'],
  task: ['task'],
};

/**
 * Returns the default child type for the "+" / add-child action.
 * project → stage, stage → substage, substage → task, task → task.
 */
export function defaultChildType(parent: ResourceType): ResourceType {
  switch (parent) {
    case 'project':
      return 'stage';
    case 'stage':
      return 'substage';
    case 'substage':
      return 'task';
    case 'task':
      return 'task';
  }
}

/** True if `child` is allowed directly under `parent`. */
export function canParent(parent: ResourceType, child: ResourceType): boolean {
  return ALLOWED_CHILDREN[parent].includes(child);
}
```

Note: `defaultChildType` return type changes from `ResourceType | null` to `ResourceType` (every type now has a default child).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/db/__tests__/types.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 5: Check no caller broke on the `| null` removal**

Run: `pnpm typecheck`
Expected: PASS. If `ProjectsView.tsx:454` (`const childType = defaultChildType(node.type)`) had a `null` check, the check becomes dead but still compiles — leave it; Task 3 does not touch it. If typecheck reports an unused-var or unreachable error, remove the now-dead `if (childType === null)` branch at that call site (minimal edit only).

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/types.ts src/lib/db/__tests__/types.test.ts
git commit -m "feat(tree): strict parent-child matrix in canParent and defaultChildType"
```

---

### Task 2: Stop `moveResource` from mutating type; reject non-project at root

**Files:**
- Modify: `src/lib/db/queries.ts:104-154`

- [ ] **Step 1: Read the current `moveResource`**

Open `src/lib/db/queries.ts`. The function spans lines 104-154. The branch to change:

```typescript
    let newType: ResourceType = node.type;
    let newPathPrefix = "";

    if (newParentId === null) {
      newType = "project";
    } else {
      const parent = await getResource(newParentId);
      if (!parent) throw new Error("New parent not found");
      if (isDescendantPath(node.path, parent.path)) {
        throw new Error("Nie można przenieść węzła pod jego własne dziecko");
      }
      if (!canParent(parent.type, node.type)) {
        throw new Error(`Typ ${node.type} nie może być dzieckiem ${parent.type}`);
      }
      newPathPrefix = `${parent.path}/`;
    }
```

- [ ] **Step 2: Replace that branch**

Replace the block above with:

```typescript
    const newType: ResourceType = node.type; // type is fixed at creation — move never changes it
    let newPathPrefix = "";

    if (newParentId === null) {
      if (node.type !== "project") {
        throw new Error("Tylko projekt może być na najwyższym poziomie");
      }
    } else {
      const parent = await getResource(newParentId);
      if (!parent) throw new Error("New parent not found");
      if (isDescendantPath(node.path, parent.path)) {
        throw new Error("Nie można przenieść węzła pod jego własne dziecko");
      }
      if (!canParent(parent.type, node.type)) {
        throw new Error(`Typ ${node.type} nie może być dzieckiem ${parent.type}`);
      }
      newPathPrefix = `${parent.path}/`;
    }
```

The rest of the function (path build, descendant collection, UPDATE, `rewriteDescendantPaths`, `recalcAncestorChain` x2, outbox enqueue) is unchanged. `newType` is still passed to the `UPDATE ... SET ... type = $2` statement — now always equal to the node's current type, so type is preserved.

- [ ] **Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS. `newType` is now `const` — confirm nothing else reassigns it.

- [ ] **Step 4: Run the full sync test suite (regression check)**

Run: `pnpm test`
Expected: PASS — all existing tests still green (no sync logic touched).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/queries.ts
git commit -m "feat(tree): moveResource keeps node type, rejects non-project at root"
```

---

### Task 3: Tighten the root-drop guard in `ProjectsView`

**Files:**
- Modify: `src/components/ProjectsView.tsx:300-312`

- [ ] **Step 1: Read the current `canDropOn`**

In `src/components/ProjectsView.tsx`, lines 300-312:

```typescript
  const canDropOn = (sourceId: string, targetId: string | null): boolean => {
    const source = findResource(sourceId);
    if (!source) return false;
    if (targetId === null) {
      // Dropping at root area = make project.
      return source.type !== "project" || source.parent_id !== null;
    }
    if (sourceId === targetId) return false;
    const target = findResource(targetId);
    if (!target) return false;
    if (isDescendantPath(source.path, target.path)) return false;
    return canParent(target.type, source.type);
  };
```

- [ ] **Step 2: Replace the root branch**

Replace lines 303-306 (the `if (targetId === null)` block) with:

```typescript
    if (targetId === null) {
      // Only a project may live at the top level.
      return source.type === "project";
    }
```

The rest of `canDropOn` stays. Dropping an already-root project at root passes the guard but `moveResource` no-ops (`node.parent_id === newParentId` early return) — harmless.

- [ ] **Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: PASS — no unused vars, no warnings.

- [ ] **Step 5: Manual verification in the running app**

Run: `pnpm tauri dev`

Verify by drag-drop:
- Drag a **project** onto another **project** → drops, becomes a subproject, type stays "project" (check it still shows project styling / can hold stages).
- Drag a **stage** onto another **stage** → drop rejected (no highlight, snaps back).
- Drag a **task** onto another **task** → drops as a subtask.
- Drag a **stage** to empty root area → drop rejected.
- Drag a top-level **project** to empty root area → no-op (stays put, no error).
- Click "+" on a **task** → adds a child task.

Expected: all behaviors as listed.

- [ ] **Step 6: Commit**

```bash
git add src/components/ProjectsView.tsx
git commit -m "feat(tree): only projects may be dropped at top level"
```

---

### Task 4: Update CLAUDE.md

**Files:**
- Modify: `D:\Projects\tracker\CLAUDE.md`

- [ ] **Step 1: Document the new rules**

In `CLAUDE.md`, under "Architecture decisions" or "Key invariants", add a note:

```markdown
- **Tree nesting rules:** parent→child matrix enforced by `canParent` (`src/lib/db/types.ts`):
  project→[project,stage,task], stage→[substage,task], substage→[task], task→[task].
  Only a project may be top-level. Node `type` is fixed at creation — `moveResource` never mutates it.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document tree nesting rules"
```

---

## Self-Review

**Spec coverage:**
- Parent→child matrix → Task 1 (`canParent` + tests).
- `defaultChildType` incl. task→task → Task 1.
- Type immutability → Task 2 (`newType = node.type`, `const`).
- Top-level constraint (DB) → Task 2 (non-project-to-root throw).
- Top-level constraint (UI) → Task 3 (`canDropOn` root branch).
- `canDrop` picks up new matrix automatically → Task 3 leaves the non-root branch calling `canParent` untouched — confirmed covered.
- Add-child UI consumes `defaultChildType` → Task 1 Step 5 verifies the call site compiles; Task 3 Step 5 verifies task→subtask manually.
- No migration → stated in header + File Structure.
- Tests → Task 1 (pure-function matrix). `moveResource` DB tests intentionally omitted (no test harness — explained in File Structure, consistent with codebase).

**Placeholder scan:** No TBD/TODO. Every code step shows full code. Commands have expected output.

**Type consistency:** `canParent(parent, child)` signature unchanged. `defaultChildType` return type narrows `ResourceType | null` → `ResourceType` — flagged in Task 1 Step 3 and checked in Step 5. `ALLOWED_CHILDREN` keyed by `ResourceType`, values `ResourceType[]` — consistent. `moveResource` `newType` stays `ResourceType`, passed to same `UPDATE` param.
