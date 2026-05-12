# Implementation Plan: Supabase Cloud Sync

## Overview

Add optional Supabase-backed cloud synchronization to the local-first time-tracking app. Uses a transactional outbox pattern: every local SQLite mutation atomically enqueues a sync record, and a foreground TypeScript worker drains the outbox to Supabase Postgres. On login, a one-shot pull with LWW merge reconciles local and cloud state. The feature is fully opt-in — without env vars, the app behaves identically to offline-only mode.

## Tasks

- [ ] 1. Supabase client + environment scaffold
  - [-] 1.1 Install `@supabase/supabase-js` and create `src/lib/supabase.ts` singleton
    - Install dependency: `pnpm add @supabase/supabase-js`
    - Create `.env.example` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
    - Implement nullable client: returns `null` when env vars missing, logs console warning
    - Configure `persistSession: true` and `autoRefreshToken: true`
    - Verify `.env.local` is gitignored
    - _Requirements: 1.1, 1.2, 1.4, 3.2_

- [ ] 2. Auth store and session management
  - [~] 2.1 Create `src/store/auth.ts` Zustand store with full auth lifecycle
    - Define `AuthState` union type: `loading | anonymous | authed`
    - Define `SyncStatus` union type: `idle | initial-pull | syncing | offline | error`
    - Implement `init()`: call `getSession()`, subscribe to `onAuthStateChange`
    - Implement `signIn`, `signUp`, `signOut` methods delegating to Supabase Auth
    - Implement `setSyncStatus`, `setPendingCount`, `setLastSyncAt` setters
    - _Requirements: 2.1, 2.2, 2.6, 3.1, 3.3, 3.4, 15.1, 15.2_

  - [~] 2.2 Wire auth store initialization in `src/main.tsx`
    - Call `useAuthStore.getState().init()` before React render
    - _Requirements: 3.1_

- [ ] 3. Auth UI components
  - [~] 3.1 Create `src/components/Auth/AuthModal.tsx` with Login/Signup tabs
    - Implement email validation: must contain `@`, max 254 chars
    - Implement password validation: min 8 chars, max 128 chars
    - Display inline validation errors
    - Display Supabase error messages inline without closing modal
    - Disable submit button while request in progress
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7_

  - [~] 3.2 Create `src/components/Auth/AuthGate.tsx` header component
    - Show "Sign in" button when anonymous, spinner when loading
    - Show truncated email (max 30 chars) + dropdown with "Sign out" when authed
    - Return `null` when `supabase` client is null (env vars missing)
    - _Requirements: 1.2, 12.1, 12.2, 12.3, 12.4, 12.5_

  - [~] 3.3 Mount `AuthGate` in `src/App.tsx` header navigation
    - Add to right side of existing nav bar
    - _Requirements: 12.1_

- [~] 4. Checkpoint
  - Ensure typecheck + lint pass (`pnpm typecheck && pnpm lint`), ask the user if questions arise.

- [ ] 5. Postgres schema migration + RLS
  - [~] 5.1 Create `supabase/migrations/20260512000001_init.sql` with resources and events tables
    - Define `resources` table with `user_id UUID NOT NULL`, all columns matching local schema, `TIMESTAMPTZ` timestamps
    - Define `events` table with `user_id UUID NOT NULL`, `resource_id` FK, `DATE` for date column
    - Add indexes on `user_id`, `path`, `date`, `resource_id`
    - Enable RLS on both tables
    - Create `own_resources` and `own_events` policies restricting all ops to `auth.uid()`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 13.1, 13.2, 13.3, 13.4, 13.5_

  - [~] 5.2 Create `supabase/README.md` migration runbook
    - Document manual apply steps via SQL Editor
    - Document RLS verification query
    - _Requirements: 13.1_

- [ ] 6. Local sync_outbox schema
  - [~] 6.1 Add `sync_outbox` table DDL to `src/lib/db/schema.ts`
    - `id INTEGER PRIMARY KEY AUTOINCREMENT`, `entity`, `entity_id`, `op`, `payload`, `enqueued_at`, `attempts`, `last_error`, `next_retry_at`
    - Add CHECK constraints for `entity` and `op` values
    - Add index on `next_retry_at`
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

  - [~] 6.2 Add `OutboxRow`, `OutboxEntity`, `OutboxOp` types to `src/lib/db/types.ts`
    - _Requirements: 14.1, 14.2, 14.3_

- [ ] 7. Outbox enqueue helpers + wire mutations
  - [~] 7.1 Create `src/lib/sync/types.ts` with `Entity`, `Op` type definitions
    - _Requirements: 5.3_

  - [~] 7.2 Create `src/lib/sync/outbox.ts` with enqueue, listReady, deleteByIds, bumpRetry, countPending helpers
    - `enqueue(db, entity, entityId, op, data)` — inserts row with JSON payload + timestamp
    - `listReady(db, now, limit)` — selects rows where `next_retry_at IS NULL OR <= now`
    - `deleteByIds(db, ids)` — bulk delete by ID
    - `bumpRetry(db, ids, errMsg, nowMs)` — increment attempts, compute backoff using `min(2^attempts × 1000, 300000)`
    - **CRITICAL**: Before storing `errMsg` in `last_error`, truncate to max 1024 characters via `errMsg.slice(0, 1024)`
    - `countPending(db)` — count all outbox rows
    - `listRecentErrors(db, limit)` — select rows with non-null `last_error` ordered by `id DESC`
    - `clearAll(db)` — delete all outbox rows
    - `resetRetry(db)` — set `next_retry_at = NULL` for all rows where `last_error IS NOT NULL` (used by "Retry now" UI)
    - _Requirements: 6.2, 6.4, 6.5, 6.6, 11.1, 11.3, 11.4_

  - [ ] 7.3 Wire `enqueue` into every mutation in `src/lib/db/queries.ts`
    - Add enqueue call after each mutation: `createResource`, `renameResource`, `setResourceColor`, `moveResource`, `softDeleteSubtree`, `liftChildrenAndDelete`, `detachChildrenAsProjects`, `createEvent`
    - Ensure enqueue uses same `db` handle (atomic with mutation)
    - Pattern for single-row mutations: after the UPDATE/INSERT, `SELECT * FROM resources WHERE id = $1`, then `enqueue(db, 'resource', id, 'upsert', row)`
    - For `softDeleteSubtree`: BEFORE the soft-delete UPDATE, collect all affected resource IDs AND event IDs (via `SELECT id FROM resources WHERE path = ? OR path LIKE ?` and `SELECT id FROM events WHERE resource_id IN (...)`). AFTER the UPDATEs, re-fetch each affected row and enqueue it (resources as `'resource'`, events as `'event'`). This satisfies Req 5.5 which mandates enqueueing **both** resources and events in the subtree.
    - For `liftChildrenAndDelete` and `detachChildrenAsProjects`: collect affected children IDs + descendant IDs whose path was rewritten, then re-fetch and enqueue each modified resource
    - For `moveResource`: after `rewriteDescendantPaths`, re-fetch each descendant whose path changed and enqueue it (Req 5.6)
    - For `createEvent`: enqueue the event itself. The `recalcCachedMinutesForResource` call updates `cached_minutes` on resources but does NOT bump their `updated_at` — do NOT enqueue resources here (they are unchanged from a sync perspective; `cached_minutes` is a local optimization recalculated on pull)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 4.3_

  - [~] 7.4 Wrap multi-statement mutations in explicit SQLite transactions
    - `softDeleteSubtree`, `liftChildrenAndDelete`, `detachChildrenAsProjects`, `moveResource` all perform multiple `db.execute` calls. Wrap each in `BEGIN` / `COMMIT` (with `ROLLBACK` on catch) so that mutation + enqueue rows are atomic per Req 5.7
    - Use pattern: `await db.execute('BEGIN')` → try { ...mutations + enqueues... `await db.execute('COMMIT')` } catch (e) { `await db.execute('ROLLBACK')`; throw }
    - Single-statement mutations (`renameResource`, `setResourceColor`, `createResource`, `createEvent`) technically don't require explicit BEGIN/COMMIT for the mutation itself, but once an `enqueue` is appended they do. Wrap them the same way.
    - _Requirements: 5.1, 5.2, 5.7_

- [ ] 8. Checkpoint
  - Ensure typecheck + lint pass (`pnpm typecheck && pnpm lint`), ask the user if questions arise.

- [ ] 9. Outbox worker with exponential backoff
  - [~] 9.1 Create `src/lib/sync/worker.ts` with tick, startWorker, stopWorker functions
    - `tick()`: guard auth + online state, select batch, collapse duplicates, flush to Supabase, handle success/failure
    - `collapseDuplicates()`: per `(entity, entity_id)` keep highest ID; return `perEntity: { resource, event }` AND track `supersededIds` (the lower-id duplicates) separately from `latestIds` per entity
    - `flushBatch()`: map payloads to cloud format, upsert via Supabase client, return `{ ok, error, ids }` where `ids` are the latest-ids for that entity
    - `mapToCloud()`: inject `user_id`, convert timestamps ms→ISO, handle null `deleted_at`
    - **Timestamp validation (Req 7.5, Property 8)**: before calling `new Date(ms).toISOString()`, validate `Number.isInteger(v) && v > 0`. If ANY of `created_at`, `updated_at`, or `deleted_at` (when non-null) fails validation, skip that row: exclude it from the upsert batch, and record an error in its `last_error` field via `bumpRetry` (with a descriptive message like `"invalid timestamp: created_at=<value>"`). Do not throw; do not break the rest of the batch.
    - **Partial flush handling (Req 6.7)**: track success/failure per entity independently. On success for `resource` batch, delete BOTH the latest resource ids AND any superseded resource ids. On failure for `resource` batch, bump retry on the latest resource ids only (leave superseded untouched — they will be collapsed again next tick, but this keeps behavior simple and correct). Same logic for `event`. Never mix: a resource batch failure must not bump retry on event rows.
    - On any flush outcome, truncate the error message to 1024 characters before storing in `last_error` (Req 6.6)
    - `startWorker()`: store interval handle AND visibility handler reference in module-level `let` so that `stopWorker()` can both `clearInterval` AND `removeEventListener` (Req 15.3 — prevent duplicate listeners across start/stop cycles). Guard against double-start when already running.
    - `stopWorker()`: clear interval, remove visibility listener, null out both handles. In-flight tick is allowed to complete naturally (no cancellation required by Req 15.4).
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 7.1, 7.2, 7.3, 7.4, 7.5, 15.1, 15.2, 15.3, 15.4_

  - [ ] 9.2 Wire worker lifecycle in `src/main.tsx` via auth store subscription
    - Start worker + trigger immediate tick on `authed` transition
    - Stop worker on non-`authed` transition
    - _Requirements: 15.1, 15.2, 15.4_

- [ ] 10. LWW merge function
  - [ ] 10.1 Create `src/lib/sync/merge.ts` with pure `lwwMerge` function
    - Accept generic arrays with `id` and `updated_at` fields
    - Return `{ writeSqlite, pushOutbox }` partition
    - Handle mixed timestamp types (ms number vs ISO string)
    - Cloud-only → writeSqlite, local-only → pushOutbox, both → higher timestamp wins, equal → no-op
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6_

- [ ] 11. Initial pull orchestration
  - [ ] 11.1 Create `src/lib/sync/pull.ts` with `runInitialPull(userId)` function
    - Track `pulledForUser: Set<string>` to avoid redundant pulls per process
    - Fetch all cloud resources and events (RLS-filtered) including soft-deleted rows
    - Convert cloud timestamps ISO→ms via helper functions
    - Call `lwwMerge` for resources and events separately
    - Write cloud-wins to SQLite via UPSERT (ON CONFLICT DO UPDATE on `id`)
    - Enqueue local-wins to outbox
    - **Rebuild materialized paths from `parent_id` chains** (Req 8.7): after all resources are written to SQLite, walk each resource's parent chain via `parent_id` and recompute its `path` as `<ancestor_ids>/<self_id>`. UPDATE the path if it differs from what was written. This defends against drift where cloud `path` was computed with different ancestor ordering or stale ids.
    - **Recalculate `cached_minutes`** (Req 8.8): after paths are rebuilt, call `recalcCachedMinutesForResource` for every resource that appears in `writeSqlite` OR whose descendants' events were touched. Simplest correct approach: collect the set of root-ancestor ids across all merged rows and recalc each root's subtree.
    - Reload projects store to update UI: `await useProjects.getState().refresh()`
    - Set sync status throughout: `initial-pull` at start → `idle` on success → `error` with message on failure
    - On failure: leave local SQLite unchanged (don't partially apply), set status to error, do not mark user as pulled (so retry is possible)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10_

  - [ ] 11.2 Wire initial pull trigger in `src/main.tsx` auth subscription
    - Call `runInitialPull` before starting worker on first `authed` transition
    - _Requirements: 8.1, 15.1_

- [ ] 12. Sync status badge + modal
  - [~] 12.1 Create `src/components/Auth/SyncStatusBadge.tsx`
    - Apply priority order exactly per Req 10.8 (highest first): `offline` → `syncing` → `error` → `pending` → `synced`. The `initial-pull` status is rendered as a syncing variant (same priority slot as `syncing`).
    - Show pending count in amber, `✓ Synced` in green (within 60s of `lastSyncAt`), `⚠ Error` in red, `⏸ Offline` neutral
    - Open `SyncStatusModal` on click
    - Return `null` when auth state is not `authed`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [~] 12.2 Create `src/components/Auth/SyncStatusModal.tsx`
    - Display up to 20 error rows with entity, entity_id, attempts, last_error (ordered by `id DESC`)
    - **"Retry now" button** (Req 11.3): first call `resetRetry(db)` to clear `next_retry_at` for all errored rows, THEN call `tick()`, THEN refresh the error list. Without the reset, rows still in backoff window will be skipped by `listReady` and the retry is a no-op.
    - **"Clear outbox" button** (Req 11.4, 11.5, 11.6): show a confirmation dialog (`confirm()` or a custom modal). On cancel: leave outbox untouched, keep modal open. On confirm: `clearAll(db)` → update `pendingCount` to 0 → close modal.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ] 12.3 Mount `SyncStatusBadge` in `src/App.tsx` header next to AuthGate
    - _Requirements: 10.1_

- [ ] 13. Checkpoint
  - Ensure typecheck + lint pass (`pnpm typecheck && pnpm lint`), ask the user if questions arise.

- [ ] 14. Test infrastructure setup
  - [ ] 14.1 Install test dependencies and configure Vitest
    - Install: `vitest`, `@vitest/ui`, `happy-dom`, `@testing-library/react`, `@testing-library/jest-dom`, `fast-check`
    - Create `vitest.config.ts` extending Vite config with happy-dom environment
    - Create `src/test/setup.ts` with jest-dom matchers
    - Add `test`, `test:watch`, `test:cov` scripts to `package.json`
    - _Requirements: (testing infrastructure)_

- [ ] 15. Property-based tests and unit tests
  - [ ]* 15.1 Write property tests for LWW merge (`src/lib/sync/__tests__/merge.test.ts`)
    - **Property 1: LWW Merge Correctness** — cloud-only→writeSqlite, local-only→pushOutbox, both→higher timestamp wins, equal→neither
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.6**
    - **Property 2: LWW Merge Idempotence** — merge(merge(local,cloud), cloud) ≡ merge(local, cloud)
    - **Validates: Requirements 8.10**
    - Include example-based unit tests for edge cases (empty sets, mixed ISO/ms timestamps)
    - Minimum 100 iterations per property

  - [ ]* 15.2 Write property tests for timestamp conversion (`src/lib/sync/__tests__/worker.test.ts`)
    - **Property 3: Timestamp Conversion Round-Trip** — msToIso then isoToMs yields original value
    - **Validates: Requirements 7.1, 7.4**
    - **Property 6: Exponential Backoff Bounded** — `min(2^(N+1) × 1000, 300000)` for any N ≥ 0
    - **Validates: Requirements 6.5**
    - **Property 7: Cloud Data Mapping Injects User ID** — mapToCloud always includes user_id
    - **Validates: Requirements 7.2**
    - **Property 8: Invalid Timestamp Detection** — non-positive-integer timestamps are rejected
    - **Validates: Requirements 7.5**
    - **Property 5: Duplicate Collapse Preserves Latest** — collapse keeps highest ID per (entity, entity_id)
    - **Validates: Requirements 6.3**
    - **Property 12: Error Message Truncation** — stored last_error ≤ 1024 chars
    - **Validates: Requirements 6.6**
    - Minimum 100 iterations per property

  - [ ]* 15.3 Write property tests for outbox enqueue (`src/lib/sync/__tests__/outbox.test.ts`)
    - **Property 4: Transactional Outbox Enqueue Integrity** — enqueued row has correct entity, entity_id, op, valid JSON payload, positive enqueued_at
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 4.3, 14.5**
    - **Property 9: Subtree Operations Enqueue All Affected Entities** — soft-delete of root produces N+1 resource rows + event rows for subtree
    - **Validates: Requirements 5.5, 5.6**
    - Minimum 100 iterations per property

  - [ ]* 15.4 Write property tests for auth validation (`src/components/Auth/__tests__/validation.test.ts`)
    - **Property 10: Email Validation** — accepts iff contains `@` AND length ≤ 254
    - **Validates: Requirements 2.4**
    - **Property 11: Password Validation** — accepts iff length ≥ 8 AND ≤ 128
    - **Validates: Requirements 2.5**
    - Extract validation functions to testable module
    - Minimum 100 iterations per property

  - [ ]* 15.5 Write unit tests for auth store state transitions
    - Test: loading → anonymous when no session
    - Test: loading → authed when valid session exists
    - Test: authed → anonymous on signOut
    - Test: init sets anonymous when supabase is null
    - _Requirements: 2.1, 2.6, 3.1, 3.3_

  - [ ]* 15.6 Write unit tests for worker tick logic
    - Test: tick skips when auth state is anonymous
    - Test: tick skips when navigator.onLine is false (sets offline status)
    - Test: successful flush deletes outbox rows and updates status
    - Test: failed flush bumps retry with backoff
    - Test: partial failure (one entity type fails) handles correctly
    - _Requirements: 6.1, 6.4, 6.5, 6.7, 6.8, 15.2_

  - [ ]* 15.7 Write unit tests for pull logic
    - Test: pull triggered only once per user per process
    - Test: pull failure leaves local data unchanged and sets error status
    - Test: pull writes cloud-wins to SQLite and enqueues local-wins
    - _Requirements: 8.1, 8.9_

- [ ] 16. Checkpoint
  - Ensure all tests pass (`pnpm typecheck && pnpm lint && pnpm test`), ask the user if questions arise.

- [ ] 17. Documentation update
  - [ ] 17.1 Update `CLAUDE.md` with Phase 4 completion notes
    - Document env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
    - Document migration runbook reference
    - Document test commands (`pnpm test`, `pnpm test:cov`)
    - Mark Phase 4 as complete
    - _Requirements: 1.1, 1.4_

- [ ] 18. Final checkpoint
  - Ensure all tests pass (`pnpm typecheck && pnpm lint && pnpm test`), ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation (typecheck + lint green at each stage; tests green from task 14 onward)
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation order ensures no orphaned code: each step builds on previous steps and is immediately wired in
- All sync components check for `supabase === null` before operating (graceful degradation)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "5.1", "5.2", "6.1", "6.2"] },
    { "id": 2, "tasks": ["2.2", "3.1", "7.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "7.2"] },
    { "id": 4, "tasks": ["7.3"] },
    { "id": 5, "tasks": ["9.1", "10.1"] },
    { "id": 6, "tasks": ["9.2", "11.1"] },
    { "id": 7, "tasks": ["11.2", "12.1", "12.2"] },
    { "id": 8, "tasks": ["12.3"] },
    { "id": 9, "tasks": ["14.1"] },
    { "id": 10, "tasks": ["15.1", "15.2", "15.3", "15.4", "15.5", "15.6", "15.7"] },
    { "id": 11, "tasks": ["17.1"] }
  ]
}
```
