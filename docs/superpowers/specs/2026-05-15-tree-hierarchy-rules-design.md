# Tree Hierarchy Rules — Design Spec

**Date:** 2026-05-15
**Status:** Approved
**Scope:** Resource tree parent/child rules — folder-like nesting with the project→stage→substage→task hierarchy.

---

## Problem

Resources behave like folders/subfolders, but the current type rules are too loose:

- `canParent(parent, child)` returns `parent !== "task"` — any non-task can hold any type. Stage can sit under stage, project under a substage, etc.
- `moveResource` forces `type = "project"` when a node is dropped at root, mutating type on move.
- `defaultChildType(task)` returns `null` — a task cannot get a child task.

The user wants strict folder semantics keyed to their hierarchy:

- Hierarchy: **project → stage → substage → task**.
- A **task** is the smallest unit and can go anywhere — including under another task.
- A **project** can become a subproject **only** by being moved into another project. That is the *only* scenario where a project nests.
- Node **type is fixed at creation** — moving never changes it. A nested project is still a project (a "subproject"); a task is always a task.
- Only a **project** may be top-level (`parent_id = null`).

---

## Rules

### Parent → allowed children

| Parent      | Allowed children          |
|-------------|---------------------------|
| project     | project, stage, task      |
| stage       | substage, task            |
| substage    | task                      |
| task        | task                      |
| (root/null) | project only              |

Rationale:
- `project→project` is the single project-nesting path → satisfies "only way a project becomes a subproject".
- Stage cannot nest under stage, substage cannot nest under substage → keeps the project-stage-substage-task chain clean.
- Task is a universal leaf-or-branch — allowed under every type and under itself.

### Type immutability

Type is set once at creation. `moveResource` never mutates `type`. Cycle protection (`isDescendantPath`) stays.

### Top-level constraint

Move to `parent_id = null` is allowed only when `node.type === "project"`. Any other type thrown back with an error; UI rejects the drop visually.

---

## Components

### 1. `src/lib/db/types.ts`

- **`canParent(parent, child)`** — rewrite from `parent !== "task"` to the real matrix above.
- **`defaultChildType(parent)`** — used by the "+" / add-child action:
  - project → `stage`
  - stage → `substage`
  - substage → `task`
  - task → `task` (currently `null`)

### 2. `src/lib/db/queries.ts` — `moveResource`

- Remove `newType = "project"` branch. `newType` is always `node.type`.
- Move to `null`: if `node.type !== "project"` throw (e.g. `"Tylko projekt może być na najwyższym poziomie"`).
- Move under a parent: keep `isDescendantPath` cycle guard; `canParent(parent.type, node.type)` now enforces the real matrix.
- Unchanged: descendant path rewrite, `cached_minutes` recalc on both old + new ancestor chains, outbox enqueue of self + descendants.

### 3. `src/components/ProjectsView.tsx` — drag-drop

- `canDrop` (≈ line 311) already calls `canParent` → picks up the new matrix automatically.
- Root drop handler (≈ line 359, `move(src, null)`): add guard so only `source.type === "project"` is accepted; otherwise no-op / `dropEffect = "none"`.
- Illegal targets already render as non-highlighted via existing `canDrop` logic.

### 4. `src/components/Tree/TreeNode.tsx` + add-child UI

- The "+" / context-menu "add child" path uses `defaultChildType` → a task now offers "add subtask".
- No structural change beyond consuming the updated `defaultChildType`.

---

## Data / Migration

**No DB migration.** Schema (`resources` table, `type` CHECK constraint, materialized path / ltree) is unchanged. Only TypeScript validation rules change.

Existing data created under the old loose rule (e.g. a stage already nested under a stage) is left as-is. The new matrix is enforced only on *new* moves and creations — no retroactive rewrite, no data loss.

---

## Error Handling

- `moveResource` throws on: cycle, illegal parent/child pair, non-project to root.
- UI prevents most illegal moves before the call (`canDrop` returns false → drop rejected, cursor shows no-drop).
- Thrown errors surface through the existing move error path in `ProjectsView` (same as today's `canParent` failure).

---

## Testing

New / updated tests:

- **`canParent`** — full matrix: every allowed pair passes, every disallowed pair fails (stage→stage, substage→substage, project under stage/substage/task, etc.).
- **`defaultChildType`** — new mapping incl. `task → task`.
- **`moveResource`**:
  - project moved into project → OK (becomes subproject, type stays `project`).
  - stage moved under stage → rejected.
  - non-project moved to root → rejected.
  - cycle (node under its own descendant) → rejected.
  - task moved under task → OK.
  - type unchanged after any successful move.

Coverage target for `src/lib/sync/` stays ≥ 80% (unaffected — no sync logic change).

---

## Out of Scope

- No retroactive cleanup of legacy loose-rule data.
- No change to creation UI beyond `defaultChildType` consumption.
- No schema / Postgres migration.
- No change to LWW merge, realtime, or presence.
