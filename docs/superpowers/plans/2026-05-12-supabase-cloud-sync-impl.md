# Faza 4 — Supabase Cloud Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build optional Supabase-backed cloud sync layer over existing local-first SQLite tracker, so a logged-in user can back up and restore data across devices without breaking anonymous-mode UX.

**Architecture:** All mutations write to local SQLite *and* a `sync_outbox` table in the same transaction. A foreground TS worker drains the outbox to Postgres via `@supabase/supabase-js`. On login, a one-shot pull + LWW (last-write-wins) merge syncs both directions. App is fully functional offline / anonymous; auth + sync are opt-in.

**Tech Stack:** `@supabase/supabase-js` v2, Vitest + happy-dom, existing Tauri 2 + React 19 + SQLite (`tauri-plugin-sql`) + Zustand 5 stack.

**Reference:** Design spec at `docs/superpowers/specs/2026-05-11-supabase-cloud-sync-design.md`.

---

## File Structure

**Create:**
- `.env.example` — committed template for env vars
- `src/lib/supabase.ts` — client singleton, null when env vars missing
- `src/store/auth.ts` — Zustand auth + syncStatus store
- `src/components/Auth/AuthGate.tsx` — header badge + popover
- `src/components/Auth/AuthModal.tsx` — Login/Signup tabs
- `src/components/Auth/SyncStatusBadge.tsx` — sync status visual
- `src/components/Auth/SyncStatusModal.tsx` — error list + retry/clear buttons
- `src/lib/sync/outbox.ts` — enqueue helpers (called from `queries.ts`)
- `src/lib/sync/worker.ts` — interval-based flush worker
- `src/lib/sync/merge.ts` — pure LWW merge function
- `src/lib/sync/pull.ts` — initial pull orchestration
- `src/lib/sync/types.ts` — sync types (`OutboxRow`, `OutboxOp`, `Entity`)
- `supabase/migrations/20260512000001_init.sql` — postgres schema + RLS
- `supabase/README.md` — migration runbook
- `vitest.config.ts` — test runner config
- `src/test/setup.ts` — happy-dom setup
- `src/lib/sync/__tests__/merge.test.ts`
- `src/lib/sync/__tests__/outbox.test.ts`
- `src/lib/sync/__tests__/worker.test.ts`
- `src/lib/sync/__tests__/pull.test.ts`

**Modify:**
- `src/lib/db/schema.ts` — add `sync_outbox` table
- `src/lib/db/types.ts` — add `OutboxRow` type export
- `src/lib/db/queries.ts` — enqueue from every mutation; export outbox helpers
- `src/App.tsx` — mount AuthGate in header, wire auth state init
- `src/main.tsx` — boot sequence init (auth getSession, worker start hook)
- `package.json` — add deps (`@supabase/supabase-js`, vitest, happy-dom, testing-library/react)
- `.gitignore` — confirm `.env.local` covered (already is via `.env.*`)
- `CLAUDE.md` — mark Phase 4 done, document env vars + migration runbook

---

## Conventions for this plan

- All file paths absolute under `D:\Projects\tracker\` unless noted as relative.
- Every TDD task: write failing test → run it (verify FAIL) → implement → run again (verify PASS) → commit.
- Commands are PowerShell. Use `pnpm`. **Never** prefix git commands with `cd`.
- Commit messages follow `feat(cloud):` / `test(cloud):` / `docs(cloud):` per `CLAUDE.md`.
- Each task ends green: `pnpm typecheck && pnpm lint` must pass before commit; from Task 10 onward also `pnpm test`.

---

## Task 1: Add Supabase client + env vars scaffold

**Files:**
- Create: `.env.example`
- Create: `src/lib/supabase.ts`
- Modify: `package.json` (add dep)
- Verify: `.gitignore` already contains `.env.*`

- [ ] **Step 1: Install `@supabase/supabase-js`**

Run:
```powershell
pnpm add @supabase/supabase-js
```
Expected: package added under `dependencies`, lockfile updated.

- [ ] **Step 2: Create `.env.example` (committed template)**

Create `D:\Projects\tracker\.env.example`:
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

- [ ] **Step 3: Confirm `.env.local` is gitignored**

Run:
```powershell
git check-ignore -v .env.local
```
Expected: output mentions `.gitignore:.env.*` (or similar). If empty: append `.env.local` to `.gitignore` immediately.

- [ ] **Step 4: Create `src/lib/supabase.ts`**

Create file:
```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !key) {
  console.warn('[supabase] env vars missing — cloud sync disabled');
}

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null;
```

- [ ] **Step 5: Typecheck + lint**

Run:
```powershell
pnpm typecheck; pnpm lint
```
Expected: both pass.

- [ ] **Step 6: Commit**

```powershell
git add package.json pnpm-lock.yaml .env.example src/lib/supabase.ts
git commit -m "feat(cloud): add supabase client + env scaffold"
```

---

## Task 2: Auth store (Zustand)

**Files:**
- Create: `src/store/auth.ts`
- Modify: `src/main.tsx` (boot — getSession on start)

- [ ] **Step 1: Create `src/store/auth.ts`**

```ts
import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type AuthState =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | { kind: 'authed'; user: User; session: Session };

export type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'initial-pull' }
  | { kind: 'syncing' }
  | { kind: 'offline' }
  | { kind: 'error'; message: string };

interface AuthStore {
  state: AuthState;
  syncStatus: SyncStatus;
  pendingCount: number;
  lastSyncAt: number | null;
  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setSyncStatus: (s: SyncStatus) => void;
  setPendingCount: (n: number) => void;
  setLastSyncAt: (t: number) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  state: { kind: 'loading' },
  syncStatus: { kind: 'idle' },
  pendingCount: 0,
  lastSyncAt: null,

  init: async () => {
    if (!supabase) {
      set({ state: { kind: 'anonymous' } });
      return;
    }
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      set({
        state: {
          kind: 'authed',
          user: data.session.user,
          session: data.session,
        },
      });
    } else {
      set({ state: { kind: 'anonymous' } });
    }
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        set({
          state: { kind: 'authed', user: session.user, session },
        });
      } else {
        set({ state: { kind: 'anonymous' } });
      }
    });
  },

  signIn: async (email, password) => {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },

  signUp: async (email, password) => {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  },

  signOut: async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  },

  setSyncStatus: (s) => set({ syncStatus: s }),
  setPendingCount: (n) => set({ pendingCount: n }),
  setLastSyncAt: (t) => set({ lastSyncAt: t }),
}));
```

- [ ] **Step 2: Wire boot init in `src/main.tsx`**

Find the existing boot block (around React `createRoot` call). Add before render:
```ts
import { useAuthStore } from '@/store/auth';
// ...
void useAuthStore.getState().init();
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck; pnpm lint`
Expected: pass.

- [ ] **Step 4: Commit**

```powershell
git add src/store/auth.ts src/main.tsx
git commit -m "feat(cloud): auth store with getSession + onAuthStateChange"
```

---

## Task 3: Auth UI — AuthModal + AuthGate

**Files:**
- Create: `src/components/Auth/AuthModal.tsx`
- Create: `src/components/Auth/AuthGate.tsx`
- Modify: `src/App.tsx` (mount AuthGate in header)

- [ ] **Step 1: Create `AuthModal.tsx`**

```tsx
import { useState } from 'react';
import { useAuthStore } from '@/store/auth';

type Tab = 'login' | 'signup';

interface Props { onClose: () => void; }

export function AuthModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = useAuthStore((s) => s.signIn);
  const signUp = useAuthStore((s) => s.signUp);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.includes('@')) { setError('Invalid email'); return; }
    if (password.length < 8) { setError('Password min 8 chars'); return; }
    setBusy(true);
    try {
      if (tab === 'login') await signIn(email, password);
      else await signUp(email, password);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96 shadow-xl">
        <div className="flex gap-4 mb-4 border-b">
          <button
            className={`pb-2 ${tab === 'login' ? 'border-b-2 border-blue-500' : ''}`}
            onClick={() => setTab('login')}>Login</button>
          <button
            className={`pb-2 ${tab === 'signup' ? 'border-b-2 border-blue-500' : ''}`}
            onClick={() => setTab('signup')}>Sign up</button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input type="email" placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded px-3 py-2" />
          <input type="password" placeholder="Password (min 8)" value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded px-3 py-2" />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1">Cancel</button>
            <button type="submit" disabled={busy}
              className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50">
              {busy ? '...' : tab === 'login' ? 'Login' : 'Create account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `AuthGate.tsx`**

```tsx
import { useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { AuthModal } from './AuthModal';
import { supabase } from '@/lib/supabase';

export function AuthGate() {
  const state = useAuthStore((s) => s.state);
  const signOut = useAuthStore((s) => s.signOut);
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  if (!supabase) return null;
  if (state.kind === 'loading') return <span className="text-xs text-gray-400">…</span>;

  if (state.kind === 'anonymous') {
    return (
      <>
        <button className="text-sm px-3 py-1 rounded border" onClick={() => setOpen(true)}>
          Sign in
        </button>
        {open && <AuthModal onClose={() => setOpen(false)} />}
      </>
    );
  }

  return (
    <div className="relative">
      <button className="text-sm px-3 py-1 rounded border" onClick={() => setMenuOpen((v) => !v)}>
        👤 {state.user.email}
      </button>
      {menuOpen && (
        <div className="absolute right-0 mt-1 bg-white shadow-lg rounded border min-w-40 z-50">
          <button
            className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
            onClick={async () => { setMenuOpen(false); await signOut(); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mount `AuthGate` in `App.tsx` header**

Find header section in `src/App.tsx` (tab nav row). Add `<AuthGate />` aligned right. Import: `import { AuthGate } from '@/components/Auth/AuthGate';`. Example header layout snippet:
```tsx
<header className="flex items-center justify-between border-b px-4 py-2">
  <nav className="flex gap-2"> {/* existing tabs */} </nav>
  <div className="flex items-center gap-2">
    <AuthGate />
  </div>
</header>
```

Keep existing tab structure; only add the right-side div with `AuthGate`.

- [ ] **Step 4: Manual smoke test**

Run: `pnpm tauri dev` (or `pnpm dev` if Tauri unavailable).
Verify: header shows "Sign in" button if env vars set; clicking opens modal; submitting with bad credentials shows red error; valid signup transitions header to email pill with sign-out menu.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck; pnpm lint`
Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add src/components/Auth src/App.tsx
git commit -m "feat(cloud): auth modal + AuthGate badge in header"
```

---

## Task 4: Postgres schema migration + RLS

**Files:**
- Create: `supabase/migrations/20260512000001_init.sql`
- Create: `supabase/README.md`

- [ ] **Step 1: Create migration SQL**

Create `D:\Projects\tracker\supabase\migrations\20260512000001_init.sql`:
```sql
BEGIN;

CREATE TABLE IF NOT EXISTS resources (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id   UUID REFERENCES resources(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('project','stage','substage','task')),
  color       TEXT,
  path        TEXT NOT NULL,
  cached_minutes INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL,
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS resources_user_idx ON resources(user_id);
CREATE INDEX IF NOT EXISTS resources_path_idx ON resources(user_id, path);

CREATE TABLE IF NOT EXISTS events (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  minutes     INTEGER NOT NULL CHECK (minutes > 0),
  goal        TEXT,
  topics      TEXT,
  notes       TEXT,
  report      TEXT,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL,
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS events_user_date_idx ON events(user_id, date);
CREATE INDEX IF NOT EXISTS events_resource_idx ON events(resource_id);

ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE events    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_resources" ON resources;
CREATE POLICY "own_resources" ON resources
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own_events" ON events;
CREATE POLICY "own_events" ON events
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

COMMIT;
```

- [ ] **Step 2: Create `supabase/README.md` runbook**

```markdown
# Supabase Migrations

## Apply manually (MVP)

1. Open Supabase dashboard → project → SQL Editor.
2. Paste contents of latest `migrations/*.sql` file.
3. Run. Wrapped in BEGIN/COMMIT — failure rolls back.
4. Verify: Table editor shows `resources` and `events` with RLS enabled (lock icon).

## RLS sanity check

In SQL Editor as auth.uid() = X (use "Run as user" or impersonate):
```sql
SELECT * FROM resources;  -- should return only rows where user_id = X
```

## Adding new migration

Filename pattern: `YYYYMMDDHHMMSS_description.sql`. Always wrap in `BEGIN; ... COMMIT;`. Make idempotent where possible (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` before create).
```

- [ ] **Step 3: Apply migration in Supabase dashboard**

Manual step: open SQL Editor in Supabase → paste content of `20260512000001_init.sql` → Run. Verify tables + RLS enabled.

- [ ] **Step 4: RLS verification**

In SQL Editor:
```sql
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('resources','events');
```
Expected: both rows show `relrowsecurity = true`.

- [ ] **Step 5: Commit**

```powershell
git add supabase/
git commit -m "feat(cloud): postgres schema migration + RLS policies"
```

---

## Task 5: Add `sync_outbox` table to local schema

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/types.ts`

- [ ] **Step 1: Append outbox table to `schema.ts`**

In `D:\Projects\tracker\src\lib\db\schema.ts`, append (inside the template literal, after events indexes):
```ts
CREATE TABLE IF NOT EXISTS sync_outbox (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity        TEXT NOT NULL CHECK (entity IN ('resource','event')),
  entity_id     TEXT NOT NULL,
  op            TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  payload       TEXT NOT NULL,
  enqueued_at   INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  next_retry_at INTEGER
);

CREATE INDEX IF NOT EXISTS sync_outbox_ready ON sync_outbox(next_retry_at);
```

- [ ] **Step 2: Add `OutboxRow` to `types.ts`**

In `D:\Projects\tracker\src\lib\db\types.ts`, append:
```ts
export type OutboxEntity = 'resource' | 'event';
export type OutboxOp = 'upsert' | 'delete';

export interface OutboxRow {
  id: number;
  entity: OutboxEntity;
  entity_id: string;
  op: OutboxOp;
  payload: string;
  enqueued_at: number;
  attempts: number;
  last_error: string | null;
  next_retry_at: number | null;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: pass.

- [ ] **Step 4: Smoke test boot**

Run: `pnpm tauri dev`
Verify: app boots, no SQL error in dev console. (Existing DBs auto-create the new table via `IF NOT EXISTS`.)

- [ ] **Step 5: Commit**

```powershell
git add src/lib/db/schema.ts src/lib/db/types.ts
git commit -m "feat(cloud): add sync_outbox table to local schema"
```

---

## Task 6: Outbox enqueue helpers + wire mutations

**Files:**
- Create: `src/lib/sync/types.ts`
- Create: `src/lib/sync/outbox.ts`
- Modify: `src/lib/db/queries.ts` (each mutation enqueues)

- [ ] **Step 1: Create `src/lib/sync/types.ts`**

```ts
export type Entity = 'resource' | 'event';
export type Op = 'upsert' | 'delete';

export interface OutboxPayload {
  entity: Entity;
  entity_id: string;
  op: Op;
  data: Record<string, unknown>;
}
```

- [ ] **Step 2: Create `src/lib/sync/outbox.ts`**

```ts
import type Database from '@tauri-apps/plugin-sql';
import type { Entity, Op } from './types';

const MAX_ERR_LEN = 1024;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

export async function enqueue(
  db: Database,
  entity: Entity,
  entityId: string,
  op: Op,
  data: Record<string, unknown>,
): Promise<void> {
  await db.execute(
    `INSERT INTO sync_outbox (entity, entity_id, op, payload, enqueued_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [entity, entityId, op, JSON.stringify(data), Date.now()],
  );
}

export async function listReady(
  db: Database,
  now: number,
  limit = 50,
): Promise<
  Array<{ id: number; entity: Entity; entity_id: string; op: Op; payload: string; attempts: number }>
> {
  return db.select(
    `SELECT id, entity, entity_id, op, payload, attempts
     FROM sync_outbox
     WHERE next_retry_at IS NULL OR next_retry_at <= $1
     ORDER BY id LIMIT $2`,
    [now, limit],
  );
}

export async function deleteByIds(db: Database, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  await db.execute(`DELETE FROM sync_outbox WHERE id IN (${placeholders})`, ids);
}

export async function bumpRetry(
  db: Database,
  ids: number[],
  errMsg: string,
  nowMs: number,
): Promise<void> {
  if (ids.length === 0) return;
  const truncated = errMsg.slice(0, MAX_ERR_LEN); // Req 6.6 / Property 12
  for (const id of ids) {
    const row = await db.select<Array<{ attempts: number }>>(
      `SELECT attempts FROM sync_outbox WHERE id = $1`,
      [id],
    );
    const attempts = (row[0]?.attempts ?? 0) + 1;
    // Req 6.5 / Property 6: min(2^attempts × 1000, 300000)
    const backoff = Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS);
    await db.execute(
      `UPDATE sync_outbox SET attempts = $1, next_retry_at = $2, last_error = $3 WHERE id = $4`,
      [attempts, nowMs + backoff, truncated, id],
    );
  }
}

export async function countPending(db: Database): Promise<number> {
  const rows = await db.select<Array<{ c: number }>>(
    `SELECT COUNT(*) as c FROM sync_outbox`,
  );
  return rows[0]?.c ?? 0;
}

// Added for SyncStatusModal (Task 8)
export async function listRecentErrors(
  db: Database,
  limit = 20,
): Promise<Array<{ id: number; entity: string; entity_id: string; last_error: string | null; attempts: number }>> {
  return db.select(
    `SELECT id, entity, entity_id, last_error, attempts
     FROM sync_outbox
     WHERE last_error IS NOT NULL
     ORDER BY id DESC LIMIT $1`,
    [limit],
  );
}

export async function clearAll(db: Database): Promise<void> {
  await db.execute(`DELETE FROM sync_outbox`);
}

// Req 11.3: "Retry now" — clear next_retry_at for errored rows so they're picked up immediately
export async function resetRetry(db: Database): Promise<void> {
  await db.execute(
    `UPDATE sync_outbox SET next_retry_at = NULL WHERE last_error IS NOT NULL`,
  );
}
```

- [ ] **Step 3: Wire `enqueue` into every mutation in `queries.ts`**

Open `D:\Projects\tracker\src\lib\db\queries.ts`. Every existing mutation needs an `enqueue` call that runs in the same transaction as the write, covering all rows affected (incl. descendants + events for subtree ops).

Import at top:
```ts
import { enqueue } from '@/lib/sync/outbox';
```

Add a small transaction helper near the top of the file (after existing imports):
```ts
async function withTx<T>(fn: () => Promise<T>): Promise<T> {
  const db = await getDb();
  await db.execute('BEGIN');
  try {
    const result = await fn();
    await db.execute('COMMIT');
    return result;
  } catch (e) {
    await db.execute('ROLLBACK');
    throw e;
  }
}
```

Rewrite each mutation to run inside `withTx` and enqueue every affected row:

**`createResource`**:
```ts
export async function createResource(input: CreateResourceInput): Promise<string> {
  return withTx(async () => {
    const db = await getDb();
    const id = newId();
    const ts = now();
    let path: string;
    if (input.parentId === null) path = id;
    else {
      const parent = await getResource(input.parentId);
      if (!parent) throw new Error(`Parent ${input.parentId} not found`);
      path = buildPath(parent.path.split('/'), id);
    }
    await db.execute(
      `INSERT INTO resources (id, parent_id, name, type, color, path, cached_minutes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,0,$7,$7)`,
      [id, input.parentId, input.name, input.type, input.color ?? null, path, ts],
    );
    const rows = await db.select<Resource[]>(`SELECT * FROM resources WHERE id = $1`, [id]);
    if (rows[0]) await enqueue(db, 'resource', id, 'upsert', rows[0]);
    return id;
  });
}
```

**`renameResource`** and **`setResourceColor`**: same pattern — wrap in `withTx`, do the UPDATE, then SELECT + enqueue single row.

**`moveResource`** (Req 5.6 — enqueue every descendant whose path changed):
```ts
export async function moveResource(id: string, newParentId: string | null): Promise<void> {
  await withTx(async () => {
    const db = await getDb();
    const node = await getResource(id);
    if (!node) throw new Error('Resource not found');
    if (node.parent_id === newParentId) return;
    // ...type/cycle validation same as before...
    // ...compute newPath...
    // Collect affected descendant ids BEFORE path rewrite
    const descendants = await db.select<{ id: string }[]>(
      `SELECT id FROM resources WHERE path LIKE $1`, [`${node.path}/%`],
    );
    await db.execute(
      `UPDATE resources SET parent_id=$1, type=$2, path=$3, updated_at=$4 WHERE id=$5`,
      [newParentId, newType, newPath, ts, id],
    );
    await rewriteDescendantPaths(node.path, newPath);
    await recalcAncestorChain(node.path);
    await recalcAncestorChain(newPath);
    // Enqueue self + every descendant (fresh state)
    const affectedIds = [id, ...descendants.map((d) => d.id)];
    for (const rid of affectedIds) {
      const rows = await db.select<Resource[]>(`SELECT * FROM resources WHERE id=$1`, [rid]);
      if (rows[0]) await enqueue(db, 'resource', rid, 'upsert', rows[0]);
    }
  });
}
```

**`softDeleteSubtree`** (Req 5.5 — enqueue BOTH resources AND events in subtree):
```ts
export async function softDeleteSubtree(id: string): Promise<void> {
  await withTx(async () => {
    const db = await getDb();
    const r = await getResource(id);
    if (!r) return;
    const ts = now();
    // Collect BEFORE the UPDATE so we have the full subtree
    const resourceIds = await db.select<{ id: string }[]>(
      `SELECT id FROM resources WHERE path=$1 OR path LIKE $2`, [r.path, `${r.path}/%`],
    );
    const eventIds = await db.select<{ id: string }[]>(
      `SELECT e.id FROM events e JOIN resources r ON r.id=e.resource_id
       WHERE r.path=$1 OR r.path LIKE $2`, [r.path, `${r.path}/%`],
    );
    await db.execute(
      `UPDATE resources SET deleted_at=$1, updated_at=$1 WHERE path=$2 OR path LIKE $3`,
      [ts, r.path, `${r.path}/%`],
    );
    await db.execute(
      `UPDATE events SET deleted_at=$1, updated_at=$1
       WHERE resource_id IN (SELECT id FROM resources WHERE path=$2 OR path LIKE $3)`,
      [ts, r.path, `${r.path}/%`],
    );
    // Enqueue each affected resource (upsert, because soft-delete = deleted_at set; Req 5.4)
    for (const { id: rid } of resourceIds) {
      const rows = await db.select<Resource[]>(`SELECT * FROM resources WHERE id=$1`, [rid]);
      if (rows[0]) await enqueue(db, 'resource', rid, 'upsert', rows[0]);
    }
    // Enqueue each affected event
    for (const { id: eid } of eventIds) {
      const rows = await db.select<TimeEvent[]>(`SELECT * FROM events WHERE id=$1`, [eid]);
      if (rows[0]) await enqueue(db, 'event', eid, 'upsert', rows[0]);
    }
  });
}
```

**`liftChildrenAndDelete`** and **`detachChildrenAsProjects`**: same pattern — wrap in `withTx`, collect children + descendants with their ids BEFORE rewrites, then after all UPDATEs re-fetch and enqueue every modified resource (self + each child + each descendant whose path was rewritten).

**`createEvent`** (enqueue the event only — do NOT enqueue resources, `recalcCachedMinutesForResource` only updates `cached_minutes`, not `updated_at`, so resources are not a sync concern here):
```ts
export async function createEvent(input: CreateEventInput): Promise<string> {
  return withTx(async () => {
    const db = await getDb();
    const id = newId();
    const ts = now();
    await db.execute(
      `INSERT INTO events (id, resource_id, date, minutes, goal, topics, notes, report, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
      [id, input.resourceId, input.date, input.minutes,
       input.goal ?? null, input.topics ?? null, input.notes ?? null, input.report ?? null, ts],
    );
    await recalcCachedMinutesForResource(input.resourceId);
    const rows = await db.select<TimeEvent[]>(`SELECT * FROM events WHERE id=$1`, [id]);
    if (rows[0]) await enqueue(db, 'event', id, 'upsert', rows[0]);
    return id;
  });
}
```

- [ ] **Step 4: Verify atomicity**

Read each modified function and confirm: (a) all `db.execute`/`db.select` calls inside the mutation body are within the `withTx` block, (b) `enqueue` is called before `COMMIT`, (c) on any thrown error `ROLLBACK` is reached. Req 5.7: mutation + enqueue rows must be all-or-nothing.

- [ ] **Step 5: Manual smoke test**

Run: `pnpm tauri dev`
Create a new project in UI → open SQLite (use a SQLite browser pointed at `<appData>/tracker.db`) → verify `sync_outbox` has a row with `entity='resource'`, `op='upsert'`, valid JSON payload.

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm typecheck; pnpm lint`
Expected: pass.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/sync src/lib/db/queries.ts
git commit -m "feat(cloud): outbox enqueue wired into every mutation"
```

---

## Task 7: Outbox worker with exponential backoff

**Files:**
- Create: `src/lib/sync/worker.ts`
- Modify: `src/main.tsx` (start worker after auth ready)

- [ ] **Step 1: Create `src/lib/sync/worker.ts`**

```ts
import { getDb } from '@/lib/db/connection';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { listReady, deleteByIds, bumpRetry, countPending } from './outbox';
import type { Entity } from './types';

interface ReadyRow {
  id: number;
  entity: Entity;
  entity_id: string;
  op: 'upsert' | 'delete';
  payload: string;
  attempts: number;
}

interface CollapseResult {
  perEntity: Record<Entity, ReadyRow[]>;
  supersededIds: Record<Entity, number[]>; // older duplicates — delete on success, leave alone on failure
}

let timer: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: (() => void) | null = null;

export function collapseDuplicates(rows: ReadyRow[]): CollapseResult {
  const latest = new Map<string, ReadyRow>();
  const perEntity: Record<Entity, ReadyRow[]> = { resource: [], event: [] };
  const supersededIds: Record<Entity, number[]> = { resource: [], event: [] };

  for (const r of rows) {
    const k = `${r.entity}:${r.entity_id}`;
    const prev = latest.get(k);
    if (!prev) { latest.set(k, r); continue; }
    if (r.id > prev.id) {
      supersededIds[prev.entity].push(prev.id);
      latest.set(k, r);
    } else {
      supersededIds[r.entity].push(r.id);
    }
  }
  for (const r of latest.values()) perEntity[r.entity].push(r);
  return { perEntity, supersededIds };
}

// Exported for property tests
export function isValidTimestamp(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

// Exported for property tests
export function mapToCloud(data: Record<string, unknown>, userId: string): Record<string, unknown> {
  const toIso = (v: number) => new Date(v).toISOString();
  return {
    ...data,
    user_id: userId,
    created_at: toIso(data.created_at as number),
    updated_at: toIso(data.updated_at as number),
    deleted_at: data.deleted_at != null ? toIso(data.deleted_at as number) : null,
  };
}

// Req 7.5 / Property 8: validate timestamps before push
function validateRowTimestamps(data: Record<string, unknown>): string | null {
  if (!isValidTimestamp(data.created_at)) return `invalid created_at: ${String(data.created_at)}`;
  if (!isValidTimestamp(data.updated_at)) return `invalid updated_at: ${String(data.updated_at)}`;
  if (data.deleted_at != null && !isValidTimestamp(data.deleted_at)) {
    return `invalid deleted_at: ${String(data.deleted_at)}`;
  }
  return null;
}

interface FlushOutcome {
  // Rows that were successfully sent (or can be deleted because they were skipped with an error already recorded)
  deletableIds: number[];
  // Rows that need bumpRetry (failed batch)
  failedIds: number[];
  // Rows that were individually invalid — they stay in outbox with an error recorded
  invalidIds: number[];
  errorMessage?: string;
}

async function flushEntity(
  entity: Entity,
  latestRows: ReadyRow[],
  supersededIds: number[],
  userId: string,
): Promise<FlushOutcome> {
  const outcome: FlushOutcome = { deletableIds: [], failedIds: [], invalidIds: [] };
  if (latestRows.length === 0) {
    // Still clean up superseded rows for this entity (they have no remaining "latest" but are safe to delete)
    outcome.deletableIds.push(...supersededIds);
    return outcome;
  }
  if (!supabase) return outcome;

  // Split into valid-payload rows (to push) and invalid-timestamp rows (to mark as errored)
  const toPush: Array<{ row: ReadyRow; mapped: Record<string, unknown> }> = [];
  const db = await getDb();
  for (const row of latestRows) {
    const data = JSON.parse(row.payload) as Record<string, unknown>;
    const err = validateRowTimestamps(data);
    if (err) {
      await bumpRetry(db, [row.id], err, Date.now());
      outcome.invalidIds.push(row.id);
      continue;
    }
    toPush.push({ row, mapped: mapToCloud(data, userId) });
  }

  if (toPush.length === 0) {
    // Nothing to push — but superseded duplicates can still be deleted
    outcome.deletableIds.push(...supersededIds);
    return outcome;
  }

  const table = entity === 'resource' ? 'resources' : 'events';
  const { error } = await supabase.from(table).upsert(toPush.map((x) => x.mapped), { onConflict: 'id' });

  if (error) {
    outcome.failedIds = toPush.map((x) => x.row.id);
    outcome.errorMessage = error.message;
    // Do NOT delete supersededIds on failure — they'll be collapsed again next tick and deleted then
    return outcome;
  }

  outcome.deletableIds = [...toPush.map((x) => x.row.id), ...supersededIds];
  return outcome;
}

export async function tick(): Promise<void> {
  const auth = useAuthStore.getState();
  if (auth.state.kind !== 'authed') return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    auth.setSyncStatus({ kind: 'offline' });
    return;
  }
  const db = await getDb();
  const now = Date.now();
  const rows = (await listReady(db, now, 50)) as ReadyRow[];
  if (rows.length === 0) {
    auth.setPendingCount(await countPending(db));
    return;
  }
  auth.setSyncStatus({ kind: 'syncing' });
  const { perEntity, supersededIds } = collapseDuplicates(rows);
  const userId = auth.state.user.id;

  // Req 6.7: flush each entity independently; success/failure is per-entity
  const resOutcome = await flushEntity('resource', perEntity.resource, supersededIds.resource, userId);
  const evtOutcome = await flushEntity('event', perEntity.event, supersededIds.event, userId);

  // Delete successfully flushed rows (includes superseded duplicates for successful entities)
  await deleteByIds(db, [...resOutcome.deletableIds, ...evtOutcome.deletableIds]);

  // Bump retry only on failed latest rows (invalid-timestamp rows already had bumpRetry called per-row)
  if (resOutcome.failedIds.length > 0) {
    await bumpRetry(db, resOutcome.failedIds, resOutcome.errorMessage ?? 'unknown', Date.now());
  }
  if (evtOutcome.failedIds.length > 0) {
    await bumpRetry(db, evtOutcome.failedIds, evtOutcome.errorMessage ?? 'unknown', Date.now());
  }

  const anyFailed = resOutcome.failedIds.length + evtOutcome.failedIds.length + resOutcome.invalidIds.length + evtOutcome.invalidIds.length > 0;
  if (anyFailed) {
    const msg = [resOutcome.errorMessage, evtOutcome.errorMessage].filter(Boolean).join('; ') || 'sync error';
    auth.setSyncStatus({ kind: 'error', message: msg });
  } else {
    auth.setSyncStatus({ kind: 'idle' });
    auth.setLastSyncAt(Date.now());
  }
  auth.setPendingCount(await countPending(db));
}

export function startWorker(): void {
  if (timer) return; // Req 15.3: idempotent
  timer = setInterval(() => { void tick(); }, 10_000);
  if (typeof document !== 'undefined') {
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  }
}

export function stopWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (visibilityHandler && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
}
```

- [ ] **Step 2: Boot worker after auth ready in `src/main.tsx`**

After `useAuthStore.getState().init()` (Task 2), subscribe and start/stop the worker:
```ts
import { startWorker, stopWorker, tick } from '@/lib/sync/worker';

useAuthStore.subscribe((s, prev) => {
  if (s.state.kind === 'authed' && prev.state.kind !== 'authed') {
    startWorker();
    void tick();
  } else if (s.state.kind !== 'authed' && prev.state.kind === 'authed') {
    stopWorker();
  }
});
```

- [ ] **Step 3: Manual smoke test**

Run: `pnpm tauri dev`
- Sign up new user in app
- Create a project
- Open Supabase dashboard → `resources` table → row appears within 10s with matching `user_id`
- Verify local `sync_outbox` is empty after flush (use SQLite browser)

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck; pnpm lint`
Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/sync/worker.ts src/main.tsx
git commit -m "feat(cloud): outbox worker with collapse + exponential backoff"
```

---

## Task 8: Sync status badge + modal

**Files:**
- Create: `src/components/Auth/SyncStatusBadge.tsx`
- Create: `src/components/Auth/SyncStatusModal.tsx`
- Modify: `src/App.tsx` (mount badge next to AuthGate)
- Modify: `src/lib/sync/outbox.ts` (add `listRecentErrors`, `clearAll` helpers)
- Modify: `src/lib/sync/worker.ts` (export `tick` already done; add no-op if already exported)

- [ ] **Step 1: Add helpers to `outbox.ts`**

The `listRecentErrors`, `clearAll`, and `resetRetry` helpers are already included in the Task 6 `outbox.ts`. No changes needed here — skip to Step 2.

- [ ] **Step 2: Create `SyncStatusBadge.tsx`**

```tsx
import { useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { SyncStatusModal } from './SyncStatusModal';

// Req 10.8: priority order — offline > syncing > error > pending > synced
export function SyncStatusBadge() {
  const state = useAuthStore((s) => s.state);
  const status = useAuthStore((s) => s.syncStatus);
  const pending = useAuthStore((s) => s.pendingCount);
  const lastSyncAt = useAuthStore((s) => s.lastSyncAt);
  const [open, setOpen] = useState(false);

  if (state.kind !== 'authed') return null;

  let label: string;
  let cls = 'text-xs px-2 py-1 rounded border';

  // Priority 1: offline (overrides everything)
  if (status.kind === 'offline') {
    label = '⏸ Offline';
  }
  // Priority 2: syncing (initial-pull counts as syncing)
  else if (status.kind === 'syncing' || status.kind === 'initial-pull') {
    label = status.kind === 'initial-pull' ? 'Syncing initial…' : 'Syncing…';
    cls += ' border-amber-500 text-amber-700';
  }
  // Priority 3: error
  else if (status.kind === 'error') {
    label = '⚠ Error';
    cls += ' border-red-500 text-red-600';
  }
  // Priority 4: pending
  else if (pending > 0) {
    label = `● ${pending} pending`;
    cls += ' border-amber-500 text-amber-700';
  }
  // Priority 5: synced (default)
  else if (lastSyncAt && Date.now() - lastSyncAt < 60_000) {
    label = '✓ Synced';
    cls += ' border-green-500 text-green-700';
  }
  else {
    label = '✓ Synced';
  }

  return (
    <>
      <button className={cls} onClick={() => setOpen(true)}>{label}</button>
      {open && <SyncStatusModal onClose={() => setOpen(false)} />}
    </>
  );
}
```

- [ ] **Step 3: Create `SyncStatusModal.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { getDb } from '@/lib/db/connection';
import { listRecentErrors, clearAll, resetRetry, countPending } from '@/lib/sync/outbox';
import { tick } from '@/lib/sync/worker';
import { useAuthStore } from '@/store/auth';

interface Props { onClose: () => void; }

interface ErrRow { id: number; entity: string; entity_id: string; last_error: string | null; attempts: number; }

export function SyncStatusModal({ onClose }: Props) {
  const [errors, setErrors] = useState<ErrRow[]>([]);
  const setPendingCount = useAuthStore((s) => s.setPendingCount);

  const refresh = async () => setErrors(await listRecentErrors(await getDb()));
  useEffect(() => { void refresh(); }, []);

  // Req 11.3: reset next_retry_at FIRST so rows in backoff window are picked up immediately, THEN tick
  const onRetry = async () => {
    const db = await getDb();
    await resetRetry(db);
    await tick();
    await refresh();
  };

  // Req 11.4, 11.5, 11.6: confirm → clear → close + update pending count. Cancel → leave untouched, stay open.
  const onClear = async () => {
    if (!confirm('Clear all pending sync ops? This may cause data loss.')) return;
    const db = await getDb();
    await clearAll(db);
    setPendingCount(await countPending(db));
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-[560px] max-h-[80vh] overflow-auto shadow-xl">
        <h2 className="text-lg font-semibold mb-3">Sync status</h2>
        <div className="flex gap-2 mb-3">
          <button onClick={onRetry}
                  className="px-3 py-1 bg-blue-600 text-white rounded text-sm">Retry now</button>
          <button onClick={onClear}
                  className="px-3 py-1 bg-red-600 text-white rounded text-sm">Clear outbox</button>
          <button onClick={onClose} className="ml-auto px-3 py-1 border rounded text-sm">Close</button>
        </div>
        {errors.length === 0
          ? <p className="text-sm text-gray-500">No errors.</p>
          : <ul className="text-xs space-y-1">
              {errors.map((e) => (
                <li key={e.id} className="border-l-4 border-red-400 pl-2">
                  <code>{e.entity}/{e.entity_id}</code> (×{e.attempts}): {e.last_error}
                </li>
              ))}
            </ul>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Mount badge in `App.tsx` header**

Add to the right-side div in the header (before `<AuthGate />`):
```tsx
import { SyncStatusBadge } from '@/components/Auth/SyncStatusBadge';
// ...
<div className="flex items-center gap-2">
  <SyncStatusBadge />
  <AuthGate />
</div>
```

- [ ] **Step 5: Manual smoke test**

Run: `pnpm tauri dev`
- Sign in
- Disconnect network (turn off WiFi or kill Supabase URL)
- Create a project → badge shows `● 1 pending`
- Reconnect → badge transitions to `Syncing…` then `✓ Synced`
- Force an error (e.g. invalidate token in dev tools localStorage) → badge shows `⚠ Error`, click → modal shows last_error

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm typecheck; pnpm lint`
Expected: pass.

- [ ] **Step 7: Commit**

```powershell
git add src/components/Auth/SyncStatusBadge.tsx src/components/Auth/SyncStatusModal.tsx src/App.tsx src/lib/sync/outbox.ts
git commit -m "feat(cloud): sync status badge + retry/clear modal"
```

---

## Task 9: LWW merge function

**Files:**
- Create: `src/lib/sync/merge.ts`

- [ ] **Step 1: Create `src/lib/sync/merge.ts`**

```ts
export interface MergeRow {
  id: string;
  updated_at: number | string;
}

export interface MergeResult<T> {
  writeSqlite: T[];
  pushOutbox: T[];
}

const toMs = (v: number | string): number =>
  typeof v === 'number' ? v : Date.parse(v);

export function lwwMerge<T extends MergeRow>(local: T[], cloud: T[]): MergeResult<T> {
  const localMap = new Map(local.map((r) => [r.id, r]));
  const cloudMap = new Map(cloud.map((r) => [r.id, r]));
  const allIds = new Set<string>([...localMap.keys(), ...cloudMap.keys()]);

  const writeSqlite: T[] = [];
  const pushOutbox: T[] = [];

  for (const id of allIds) {
    const l = localMap.get(id);
    const c = cloudMap.get(id);
    if (l && !c) { pushOutbox.push(l); continue; }
    if (!l && c) { writeSqlite.push(c); continue; }
    const lt = toMs(l!.updated_at);
    const ct = toMs(c!.updated_at);
    if (lt > ct) pushOutbox.push(l!);
    else if (ct > lt) writeSqlite.push(c!);
    // equal → no-op
  }
  return { writeSqlite, pushOutbox };
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck; pnpm lint`
Expected: pass.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/sync/merge.ts
git commit -m "feat(cloud): LWW merge utility"
```

---

## Task 10: Vitest setup + test merge

**Files:**
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Modify: `package.json` (deps + `test` script)
- Create: `src/lib/sync/__tests__/merge.test.ts`

- [ ] **Step 1: Install test deps**

Run:
```powershell
pnpm add -D vitest @vitest/ui happy-dom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: { include: ['src/lib/sync/**/*.ts'] },
  },
});
```

- [ ] **Step 3: Create `src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Add `test` script to `package.json`**

Under `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:cov": "vitest run --coverage"
```

- [ ] **Step 5: Write failing test for merge**

Create `D:\Projects\tracker\src\lib\sync\__tests__\merge.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { lwwMerge } from '../merge';

interface R { id: string; updated_at: number | string; name?: string }

describe('lwwMerge', () => {
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
```

- [ ] **Step 6: Run test — verify PASS (merge.ts already implemented in Task 9)**

Run: `pnpm test`
Expected: 6 passing.

- [ ] **Step 7: Commit**

```powershell
git add vitest.config.ts src/test/setup.ts package.json pnpm-lock.yaml src/lib/sync/__tests__/merge.test.ts
git commit -m "test(cloud): vitest setup + LWW merge tests"
```

---

## Task 11: Initial pull on login

**Files:**
- Create: `src/lib/sync/pull.ts`
- Modify: `src/main.tsx` (trigger pull on first authed transition per user)

- [ ] **Step 1: Create `src/lib/sync/pull.ts`**

```ts
import { getDb } from '@/lib/db/connection';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { lwwMerge } from './merge';
import { enqueue } from './outbox';
import { recalcCachedMinutesForResource } from '@/lib/db/queries';
import type { Resource, TimeEvent } from '@/lib/db/types';
import { tick } from './worker';

const pulledForUser = new Set<string>();

const toMs = (v: unknown) => typeof v === 'string' ? Date.parse(v) : (v as number);

function cloudToLocalResource(c: Record<string, unknown>): Resource {
  return {
    id: c.id as string,
    parent_id: (c.parent_id as string | null) ?? null,
    name: c.name as string,
    type: c.type as Resource['type'],
    color: (c.color as string | null) ?? null,
    path: c.path as string,
    cached_minutes: (c.cached_minutes as number) ?? 0,
    created_at: toMs(c.created_at),
    updated_at: toMs(c.updated_at),
    deleted_at: c.deleted_at ? toMs(c.deleted_at) : null,
  };
}

function cloudToLocalEvent(c: Record<string, unknown>): TimeEvent {
  return {
    id: c.id as string,
    resource_id: c.resource_id as string,
    date: c.date as string,
    minutes: c.minutes as number,
    goal: (c.goal as string | null) ?? null,
    topics: (c.topics as string | null) ?? null,
    notes: (c.notes as string | null) ?? null,
    report: (c.report as string | null) ?? null,
    created_at: toMs(c.created_at),
    updated_at: toMs(c.updated_at),
    deleted_at: c.deleted_at ? toMs(c.deleted_at) : null,
  };
}

// Req 8.7: rebuild materialized paths from parent_id chains. Defends against path drift.
async function rebuildAllPaths(): Promise<void> {
  const db = await getDb();
  const all = await db.select<Resource[]>(`SELECT id, parent_id FROM resources`);
  const byId = new Map(all.map((r) => [r.id, r]));
  const pathCache = new Map<string, string>();

  const computePath = (id: string, visiting = new Set<string>()): string => {
    if (pathCache.has(id)) return pathCache.get(id)!;
    if (visiting.has(id)) throw new Error(`cycle detected in parent_id chain at ${id}`);
    visiting.add(id);
    const r = byId.get(id);
    if (!r) return id;
    const path = r.parent_id ? `${computePath(r.parent_id, visiting)}/${id}` : id;
    pathCache.set(id, path);
    return path;
  };

  for (const r of all) {
    const correctPath = computePath(r.id);
    await db.execute(
      `UPDATE resources SET path = $1 WHERE id = $2 AND path != $1`,
      [correctPath, r.id],
    );
  }
}

export async function runInitialPull(userId: string): Promise<void> {
  if (!supabase) return;
  if (pulledForUser.has(userId)) return;
  const auth = useAuthStore.getState();
  auth.setSyncStatus({ kind: 'initial-pull' });

  const [{ data: cloudR, error: errR }, { data: cloudE, error: errE }] = await Promise.all([
    supabase.from('resources').select('*'),
    supabase.from('events').select('*'),
  ]);
  if (errR || errE) {
    // Req 8.9: leave local data unchanged, set error, do NOT mark user as pulled (allow retry)
    auth.setSyncStatus({ kind: 'error', message: (errR || errE)!.message });
    return;
  }

  const db = await getDb();
  const localR = await db.select<Resource[]>(`SELECT * FROM resources`);
  const localE = await db.select<TimeEvent[]>(`SELECT * FROM events`);

  const cloudRloc = (cloudR ?? []).map(cloudToLocalResource);
  const cloudEloc = (cloudE ?? []).map(cloudToLocalEvent);

  const rMerge = lwwMerge(localR, cloudRloc);
  const eMerge = lwwMerge(localE, cloudEloc);

  try {
    for (const r of rMerge.writeSqlite) {
      await db.execute(
        `INSERT INTO resources (id, parent_id, name, type, color, path, cached_minutes, created_at, updated_at, deleted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT(id) DO UPDATE SET
           parent_id=excluded.parent_id, name=excluded.name, type=excluded.type,
           color=excluded.color, path=excluded.path, cached_minutes=excluded.cached_minutes,
           created_at=excluded.created_at, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`,
        [r.id, r.parent_id, r.name, r.type, r.color, r.path, r.cached_minutes,
         r.created_at, r.updated_at, r.deleted_at],
      );
    }
    for (const e of eMerge.writeSqlite) {
      await db.execute(
        `INSERT INTO events (id, resource_id, date, minutes, goal, topics, notes, report, created_at, updated_at, deleted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT(id) DO UPDATE SET
           resource_id=excluded.resource_id, date=excluded.date, minutes=excluded.minutes,
           goal=excluded.goal, topics=excluded.topics, notes=excluded.notes, report=excluded.report,
           created_at=excluded.created_at, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`,
        [e.id, e.resource_id, e.date, e.minutes, e.goal, e.topics, e.notes, e.report,
         e.created_at, e.updated_at, e.deleted_at],
      );
    }
    for (const r of rMerge.pushOutbox) await enqueue(db, 'resource', r.id, 'upsert', r);
    for (const e of eMerge.pushOutbox) await enqueue(db, 'event', e.id, 'upsert', e);

    // Req 8.7: rebuild materialized paths from parent_id chains
    await rebuildAllPaths();

    // Req 8.8: recalc cached_minutes for all resources touched by the merge.
    // Simplest correct approach: recalc for every resource written from cloud,
    // plus every resource linked by a written event.
    const touchedResourceIds = new Set<string>();
    for (const r of rMerge.writeSqlite) touchedResourceIds.add(r.id);
    for (const e of eMerge.writeSqlite) touchedResourceIds.add(e.resource_id);
    for (const rid of touchedResourceIds) {
      await recalcCachedMinutesForResource(rid);
    }
  } catch (e) {
    auth.setSyncStatus({ kind: 'error', message: e instanceof Error ? e.message : 'pull failed' });
    return;
  }

  pulledForUser.add(userId);
  auth.setSyncStatus({ kind: 'idle' });
  auth.setLastSyncAt(Date.now());

  // Reload UI. Lazy import avoids potential circular dep with store.
  const { useProjects } = await import('@/store/projects');
  await useProjects.getState().refresh();

  // Drain newly enqueued local-wins
  void tick();
}
```

- [ ] **Step 2: Wire pull trigger in `src/main.tsx` subscribe**

Update the subscribe block from Task 7:
```ts
import { runInitialPull } from '@/lib/sync/pull';

useAuthStore.subscribe((s, prev) => {
  if (s.state.kind === 'authed' && prev.state.kind !== 'authed') {
    void runInitialPull(s.state.user.id).then(() => {
      startWorker();
      void tick();
    });
  } else if (s.state.kind !== 'authed' && prev.state.kind === 'authed') {
    stopWorker();
  }
});
```

- [ ] **Step 3: Verify projects store reload works**

The `pull.ts` above already calls `useProjects.getState().refresh()` via lazy import. No changes to `src/store/projects.ts` needed — it already exports `useProjects` with a `refresh()` action that re-queries SQLite and rebuilds the tree.

- [ ] **Step 4: Manual smoke test — cross-device scenario**

1. Open app on machine A → sign up → create project "Alpha"
2. Wait for `✓ Synced` badge
3. On same machine, delete local DB file (`<appData>/tracker.db`) — simulates new device
4. Restart app → sign in same user → expect `Syncing initial…` then `✓ Synced`
5. Verify "Alpha" appears in tree

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck; pnpm lint`
Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/sync/pull.ts src/main.tsx
git commit -m "feat(cloud): initial pull + LWW merge on first login per user"
```

---

## Task 12: Outbox unit tests (pure helpers)

**Files:**
- Create: `src/lib/sync/__tests__/outbox.test.ts`

- [ ] **Step 1: Write tests for `collapseDuplicates`**

`collapseDuplicates` is already exported from `src/lib/sync/worker.ts` (Task 7). No extraction needed.

- [ ] **Step 2: Write test file**

Create `D:\Projects\tracker\src\lib\sync\__tests__\outbox.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { collapseDuplicates } from '../worker';
import type { Entity } from '../types';

interface ReadyRow {
  id: number; entity: Entity; entity_id: string;
  op: 'upsert' | 'delete'; payload: string; attempts: number;
}

const mk = (id: number, entity: Entity, entity_id: string): ReadyRow => ({
  id, entity, entity_id, op: 'upsert', payload: '{}', attempts: 0,
});

describe('collapseDuplicates', () => {
  it('empty input → empty output', () => {
    const r = collapseDuplicates([]);
    expect(r.perEntity.resource).toEqual([]);
    expect(r.perEntity.event).toEqual([]);
    expect(r.supersededIds.resource).toEqual([]);
    expect(r.supersededIds.event).toEqual([]);
  });

  it('single row → kept, no superseded', () => {
    const r = collapseDuplicates([mk(1, 'resource', 'a')]);
    expect(r.perEntity.resource).toHaveLength(1);
    expect(r.supersededIds.resource).toEqual([]);
  });

  it('duplicate (entity, entity_id) keeps highest id, marks lower as superseded', () => {
    const r = collapseDuplicates([
      mk(1, 'resource', 'a'),
      mk(5, 'resource', 'a'),
      mk(3, 'resource', 'a'),
    ]);
    expect(r.perEntity.resource).toHaveLength(1);
    expect(r.perEntity.resource[0]?.id).toBe(5);
    expect(r.supersededIds.resource.sort()).toEqual([1, 3]);
  });

  it('groups by entity, superseded tracked per-entity', () => {
    const r = collapseDuplicates([
      mk(1, 'resource', 'a'),
      mk(2, 'resource', 'a'),
      mk(3, 'event', 'b'),
    ]);
    expect(r.perEntity.resource).toHaveLength(1);
    expect(r.perEntity.resource[0]?.id).toBe(2);
    expect(r.perEntity.event).toHaveLength(1);
    expect(r.supersededIds.resource).toEqual([1]);
    expect(r.supersededIds.event).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm test`
Expected: 4 new tests pass + 6 from merge.

- [ ] **Step 4: Commit**

```powershell
git add src/lib/sync/__tests__/outbox.test.ts
git commit -m "test(cloud): collapseDuplicates unit tests"
```

---

## Task 13: Worker tick tests (mocked supabase)

**Files:**
- Create: `src/lib/sync/__tests__/worker.test.ts`

- [ ] **Step 1: Write tests for `mapToCloud` and `isValidTimestamp`**

Both are exported from `worker.ts`. Create `D:\Projects\tracker\src\lib\sync\__tests__\worker.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { collapseDuplicates, mapToCloud, isValidTimestamp } from '../worker';
import type { Entity } from '../types';

interface ReadyRow {
  id: number; entity: Entity; entity_id: string;
  op: 'upsert' | 'delete'; payload: string; attempts: number;
}

describe('collapseDuplicates contract', () => {
  it('keeps latest per (entity, entity_id) across many rows', () => {
    const rows: ReadyRow[] = [];
    for (let i = 1; i <= 20; i++) {
      rows.push({ id: i, entity: 'resource', entity_id: 'x', op: 'upsert', payload: '{}', attempts: 0 });
    }
    const r = collapseDuplicates(rows);
    expect(r.perEntity.resource).toHaveLength(1);
    expect(r.perEntity.resource[0]?.id).toBe(20);
    expect(r.supersededIds.resource).toHaveLength(19);
  });
});

describe('mapToCloud', () => {
  it('converts ms epoch timestamps to ISO strings', () => {
    const r = mapToCloud({ id: 'a', created_at: 1700000000000, updated_at: 1700000000000, deleted_at: null }, 'u1');
    expect(r.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.user_id).toBe('u1');
    expect(r.deleted_at).toBeNull();
  });

  it('preserves null deleted_at', () => {
    const r = mapToCloud({ id: 'a', created_at: 1, updated_at: 1, deleted_at: null }, 'u1');
    expect(r.deleted_at).toBeNull();
  });

  it('converts non-null deleted_at to ISO', () => {
    const r = mapToCloud({ id: 'a', created_at: 1, updated_at: 1, deleted_at: 1700000000000 }, 'u1');
    expect(typeof r.deleted_at).toBe('string');
  });

  it('always injects user_id', () => {
    const r = mapToCloud({ id: 'a', created_at: 1, updated_at: 1, deleted_at: null }, 'user-xyz');
    expect(r.user_id).toBe('user-xyz');
  });
});

describe('isValidTimestamp (Req 7.5 / Property 8)', () => {
  it('accepts positive integers', () => {
    expect(isValidTimestamp(1)).toBe(true);
    expect(isValidTimestamp(1700000000000)).toBe(true);
  });

  it('rejects zero, negatives, fractional, NaN, strings, null', () => {
    expect(isValidTimestamp(0)).toBe(false);
    expect(isValidTimestamp(-1)).toBe(false);
    expect(isValidTimestamp(1.5)).toBe(false);
    expect(isValidTimestamp(NaN)).toBe(false);
    expect(isValidTimestamp('1700000000000')).toBe(false);
    expect(isValidTimestamp(null)).toBe(false);
    expect(isValidTimestamp(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/sync/__tests__/worker.test.ts
git commit -m "test(cloud): worker collapse + mapToCloud + timestamp validation"
```

---

## Task 14: Pull merge integration tests

**Files:**
- Create: `src/lib/sync/__tests__/pull.test.ts`

- [ ] **Step 1: Write tests focused on lwwMerge applied to realistic Resource/Event shapes**

```ts
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

  it('conflict resolves by updated_at', () => {
    const local = mkResource('a', 5, 'local-name');
    const cloud = mkResource('a', 10, 'cloud-name');
    const r = lwwMerge<Resource>([local], [cloud]);
    expect(r.writeSqlite[0]?.name).toBe('cloud-name');
  });

  it('soft-deleted local with newer updated_at propagates', () => {
    const local = { ...mkResource('a', 10), deleted_at: 10 };
    const cloud = mkResource('a', 5);
    const r = lwwMerge<Resource>([local], [cloud]);
    expect(r.pushOutbox[0]?.deleted_at).toBe(10);
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
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 3: Coverage check**

Run: `pnpm test:cov`
Expected: `src/lib/sync/merge.ts` and `src/lib/sync/collapse.ts` ≥ 80% line coverage. `pull.ts` and `worker.ts` will be lower because they include I/O — acceptable per spec (manual smoke covers them).

- [ ] **Step 4: Commit**

```powershell
git add src/lib/sync/__tests__/pull.test.ts
git commit -m "test(cloud): pull/merge integration cases on real Row shapes"
```

---

## Task 15: RLS manual verification (second account)

**Files:**
- (none — manual)

- [ ] **Step 1: Create second test user**

In running app: sign out → sign up with `test2@example.com` / password.

- [ ] **Step 2: Create a project as user2**

In UI: create project "User2-Project". Wait for `✓ Synced`.

- [ ] **Step 3: Verify isolation in Supabase SQL editor**

Run in Supabase SQL editor (as service role — bypasses RLS):
```sql
SELECT user_id, name FROM resources;
```
Expected: rows for both users, distinct `user_id`.

Then run as authed user (use "Run as user" or test via the JS client with user1's session):
```sql
SELECT user_id, name FROM resources WHERE user_id != auth.uid();
```
Expected: 0 rows.

- [ ] **Step 4: Verify in app**

Sign out → sign in as user1 → tree shows only user1's projects (User2-Project absent).

- [ ] **Step 5: Document in commit**

No code change; record verification in commit body:
```powershell
git commit --allow-empty -m "test(cloud): RLS verified — second account cannot read others' rows"
```

---

## Task 16: Final docs + CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update phase status**

In `D:\Projects\tracker\CLAUDE.md` find `## Current phase` block. Replace with:
```markdown
## Current phase

**Faza 4 — Supabase Auth + Single-User Cloud Sync (DONE).** `@supabase/supabase-js` client, Zustand auth store (`useAuthStore`), header AuthGate + Sign in/up modal. SQLite `sync_outbox` table; every mutation in `queries.ts` enqueues a row in same tx as write. Foreground worker (`src/lib/sync/worker.ts`) flushes every 10s + on visibility change with exponential backoff. Pierwszy login → `runInitialPull` + LWW merge per row (`updated_at` wins). RLS in Postgres pilnuje `user_id = auth.uid()`. Vitest setup z testami `merge` + `collapse` + pull cases (80%+ na pure sync). Anonymous mode = pełna funkcjonalność Faz 1-3.

**Next: Faza 5 — Multi-tenant schema** (workspaces, ltree, RLS na workspace_id, invites).
```

- [ ] **Step 2: Update stack table**

In stack table add row:
```markdown
| Cloud BaaS | Supabase (`@supabase/supabase-js`) | 2 |
| Tests | Vitest + happy-dom + Testing Library | latest |
```

- [ ] **Step 3: Update folder structure**

In `## Struktura folderów` section, add under Aktualne:
```markdown
- `src/components/Auth/` — `AuthGate`, `AuthModal`, `SyncStatusBadge`, `SyncStatusModal`
- `src/lib/sync/` — `merge.ts`, `outbox.ts`, `worker.ts`, `pull.ts`, `collapse.ts`, `types.ts`
- `src/lib/supabase.ts` — supabase client singleton
- `src/store/auth.ts` — Zustand auth store
- `supabase/migrations/` — postgres migrations + runbook
- `src/test/setup.ts` + `vitest.config.ts` — test infra
```

- [ ] **Step 4: Add env vars + runbook section**

Append new H2 after `## Schema (current state)`:
```markdown
## Cloud sync runbook (Faza 4)

### Env vars (`.env.local`, gitignored)

```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Bez env vars app działa w trybie anonymous (Fazy 1-3). Z env vars + brak loginu = same UX, ale można się zalogować.

### Postgres migration

1. Otwórz Supabase SQL Editor
2. Wklej `supabase/migrations/20260512000001_init.sql`
3. Run (wrapped w `BEGIN/COMMIT`, rollback on error)
4. Weryfikacja: `SELECT relrowsecurity FROM pg_class WHERE relname IN ('resources','events')` — oba `true`

### Sync invariants

- Każda mutacja w `queries.ts` = INSERT do `sync_outbox` w tej samej tx
- Worker flushuje co 10s + on visibility change. Exponential backoff: `min(2^attempts * 1000, 5min)`
- LWW: `updated_at` newer wygrywa. Equal = no-op
- Soft delete propaguje normalnie (deleted_at set + updated_at bumped)
```

- [ ] **Step 5: Update Phased rollout section**

Change line `4. Supabase Auth + single-user cloud sync` to `4. **Supabase Auth + single-user cloud sync** ✓ — outbox + LWW merge + RLS`.

- [ ] **Step 6: Commit**

```powershell
git add CLAUDE.md
git commit -m "docs(cloud): mark phase 4 done, env vars + migration runbook"
```

---

## Task 17: Final validation gate

- [ ] **Step 1: Full validation**

Run sequentially:
```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
All must pass. Build must produce dist/.

- [ ] **Step 2: Production build**

Run:
```powershell
pnpm tauri build
```
Expected: `src-tauri\target\release\bundle\msi\*.msi` produced (and/or `.exe`).

- [ ] **Step 3: Acceptance checklist (spec section 10)**

Verify manually:
- [ ] Sign in → create project → close → reopen → sign in → project present
- [ ] Anonymous mode: Projects + Dashboard + skróty + drag-drop + CSV bez regresji
- [ ] Second user nie widzi cudzych danych (verified in Task 15)
- [ ] `pnpm test` green, coverage `src/lib/sync/` ≥ 80% on pure modules
- [ ] `pnpm tauri build` OK
- [ ] `CLAUDE.md` zaktualizowane

- [ ] **Step 4: Final commit (optional — only if any cleanup needed)**

If anything fixed in Step 3:
```powershell
git add -A
git commit -m "chore(cloud): final validation fixes"
```

---

## Out-of-scope reminder

Per spec sections 11–12, these are NOT in this plan and must NOT be added:
- Realtime / live multi-device sync — Faza 7
- Password reset / OAuth / magic link / 2FA — post-MVP
- Conflict resolution UI — Faza 8
- Outbox in Rust async task — Faza 8
- Multi-tenant `workspace_id` + ltree — Faza 5
- File storage / avatars — Faza 6
- Email confirmation flow — Faza 9 release

If a task seems to drift into these, stop and re-read this section.
