# Faza 4 — Supabase Auth + Single-User Cloud Sync (Design)

**Status:** design approved 2026-05-11
**Phase:** 4 (per `CLAUDE.md` phased rollout)
**Goal:** opcjonalny backup lokalnych danych do Supabase dla pojedynczego użytkownika. Single-user, multi-device acceptable. Multi-tenant odsuwa się do Fazy 5.

---

## 1. Decisions log

| # | Pytanie | Decyzja | Powód |
|---|---------|---------|-------|
| 1 | Supabase project | Nowy free-tier, region EU Frankfurt | Najbliższy, najtaniej |
| 2 | Outbox engine | TypeScript (frontend), Rust dopiero Faza 8 | YAGNI: single-user foreground app wystarczy TS; Faza 8 = hardening |
| 3 | Pierwszy login UX | Push lokalne + LWW merge per-row | Single-user = ten sam człowiek, conflict rzadki, deterministic |
| 4 | Realtime | Out of scope (Faza 7) | MVP: pull tylko on-login |
| 5 | Email confirmation | Disabled w Supabase Auth settings | MVP friction reduction |
| 6 | Password reset / OAuth / 2FA | Out of scope | Akceptowalne dla MVP |

---

## 2. Architektura

```
┌─────────── React UI ───────────┐
│  ProjectsView / DashboardView  │
│  AuthGate (badge + modal)      │
└────────────┬───────────────────┘
             │ Zustand (auth + projects)
             ▼
┌─── src/lib/db/queries.ts ──────┐   ┌─── src/lib/sync/ ──────────┐
│  CRUD na SQLite (Faza 1)       │   │  outbox.ts (enqueue)       │
│  każda mutacja: tx { write     │──▶│  worker.ts (poll + flush)  │
│    SQLite; insert outbox row } │   │  pull.ts (initial + delta) │
└────────────────────────────────┘   │  merge.ts (LWW)            │
                                     └─────────────┬──────────────┘
                                                   │ @supabase/supabase-js
                                                   ▼
                                     ┌─── Supabase ───────────────┐
                                     │  auth.users                │
                                     │  resources (RLS user_id)   │
                                     │  events    (RLS user_id)   │
                                     └────────────────────────────┘
```

Kluczowe inwarianty:

- **Mutacja transakcyjna**: SQLite write + outbox insert w jednej tx. Brak utraty operacji nawet przy crashu.
- **Worker tick**: w `App.tsx` po login → `setInterval(10_000)` + manual triggery (focus/visibility/sync button).
- **Auth opcjonalny**: bez loginu app działa jak Faza 1-3. Outbox akumuluje się od startu, ale worker nie flushuje gdy `kind !== 'authed'`.

---

## 3. Schema Postgres + RLS

Migracja `supabase/migrations/20260511000001_init.sql`:

```sql
CREATE TABLE resources (
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
CREATE INDEX resources_user_idx ON resources(user_id);
CREATE INDEX resources_path_idx ON resources(user_id, path);

CREATE TABLE events (
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
CREATE INDEX events_user_date_idx ON events(user_id, date);
CREATE INDEX events_resource_idx ON events(resource_id);

ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE events    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_resources" ON resources
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own_events" ON events
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
```

Mapowanie typów SQLite ↔ Postgres:

| SQLite | Postgres | Konwersja |
|---|---|---|
| `created_at INTEGER` (ms) | `TIMESTAMPTZ` | `new Date(ms).toISOString()` przy push, `Date.parse(iso)` przy pull |
| `path TEXT` | `path TEXT` | bez zmian (ltree dopiero Faza 5) |
| `date TEXT` (YYYY-MM-DD) | `DATE` | bez zmian (już ISO) |
| brak `user_id` | `user_id UUID NOT NULL` | wstrzykiwany przez sync engine z `session.user.id` |

---

## 4. Outbox protocol

Tabela SQLite `sync_outbox` (dodawana w `schema.ts`):

```sql
CREATE TABLE sync_outbox (
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
CREATE INDEX sync_outbox_ready ON sync_outbox(next_retry_at);
```

**Enqueue rules:**

- Każda mutacja w `queries.ts` (create/update/rename/move/delete resource + log/update event) wstawia row do `sync_outbox` w tej samej tx co write do tabeli docelowej.
- `payload` = pełny snapshot wiersza po mutacji (JSON.stringify).
- Soft delete (`deleted_at` set) wciąż używa `op=upsert` — Postgres widzi `deleted_at`. `op=delete` zarezerwowane na hard delete (na razie nieużywane).
- Idempotency: replay tej samej operacji jest no-op dzięki LWW po `updated_at`.

**Worker (`src/lib/sync/worker.ts`) pseudocode:**

```
interval = 10s
on tick:
  if authState.kind !== 'authed': return
  if !navigator.onLine: return
  rows = SELECT * FROM sync_outbox
         WHERE next_retry_at IS NULL OR next_retry_at <= now
         ORDER BY id LIMIT 50
  if rows.length == 0: return
  collapsed = collapseDuplicates(rows)   -- per (entity, entity_id) latest wins
  by entity:
    payloads = collapsed[entity].map(addUserId)
    { error } = await supabase.from(entity).upsert(payloads, { onConflict: 'id' })
  if error:
    UPDATE sync_outbox SET attempts = attempts+1,
                           next_retry_at = now + min(2^attempts * 1000, 5*60*1000),
                           last_error = error.message
    WHERE id IN (failed batch ids)
  else:
    DELETE FROM sync_outbox WHERE id IN (success batch ids)
  update status store
```

**Tick triggers:**
- `setInterval(10s)` startowany przy `kind == 'authed'`
- `onAuthStateChange` → tick on `INITIAL_SESSION`, `TOKEN_REFRESHED`
- `window.addEventListener('visibilitychange')` → tick gdy `document.visibilityState === 'visible'`
- Manual `Sync now` button w status modal

**Status UI (badge w headerze):**

| State | Display |
|---|---|
| anonymous | `Guest` (no sync badge) |
| authed, outbox empty, last_ok < 1min | `✓ Synced` |
| authed, outbox > 0 | `● {N} pending` |
| authed, mid-flush | `Syncing…` |
| authed, error | `⚠ Error` (clickable → modal z `last_error`) |
| authed, offline | `⏸ Offline` |

Klik na badge → modal: lista ostatnich błędów, button `Retry now`, button `Clear outbox` (z confirm).

---

## 5. Initial pull + LWW merge

**Trigger:** `onAuthStateChange` event `INITIAL_SESSION` lub `SIGNED_IN` z newly authed user (śledzimy flag `hasPulledForUser:Set<userId>` w pamięci sesji aplikacji).

**Flow `src/lib/sync/pull.ts`:**

```
1. authStore.setSyncStatus('initial-pull')
2. cloudResources = supabase.from('resources').select('*')     -- RLS filtruje do user_id
3. cloudEvents    = supabase.from('events').select('*')
4. localResources = SELECT * FROM resources                    -- (all, includes soft-deleted)
5. localEvents    = SELECT * FROM events
6. { writeSqlite: rR, pushOutbox: rO } = lwwMerge(localResources, cloudResources)
7. { writeSqlite: eR, pushOutbox: eO } = lwwMerge(localEvents,    cloudEvents)
8. SQLite tx:
     - upsert rR i eR (z konwersją TIMESTAMPTZ → ms)
     - enqueue do sync_outbox: rO i eO
     - rebuild path z parent_id chains dla zmienionych resources
9. recalc cached_minutes dla wszystkich rootów (wykorzystaj istniejący recalcCachedMinutesForResource)
10. projectsStore.reloadAll()
11. authStore.setSyncStatus('idle')
12. worker.tick() (drain newly enqueued)
```

**Algorytm LWW (`src/lib/sync/merge.ts`):**

```ts
type Row = { id: string; updated_at: number | string };

export function lwwMerge<T extends Row>(
  local: T[],
  cloud: T[]
): { writeSqlite: T[]; pushOutbox: T[] } {
  const localMap = new Map(local.map(r => [r.id, r]));
  const cloudMap = new Map(cloud.map(r => [r.id, r]));
  const allIds = new Set<string>([...localMap.keys(), ...cloudMap.keys()]);

  const writeSqlite: T[] = [];
  const pushOutbox: T[] = [];

  const toMs = (v: number | string) =>
    typeof v === 'number' ? v : Date.parse(v);

  for (const id of allIds) {
    const l = localMap.get(id);
    const c = cloudMap.get(id);
    if (l && !c) { pushOutbox.push(l); continue; }
    if (!l && c) { writeSqlite.push(c); continue; }
    const lt = toMs(l!.updated_at);
    const ct = toMs(c!.updated_at);
    if (lt > ct)      pushOutbox.push(l!);
    else if (ct > lt) writeSqlite.push(c!);
  }
  return { writeSqlite, pushOutbox };
}
```

**Edge cases:**

- **Path mismatch po merge**: po upserts rebuild `path` z `parent_id` chains (idempotent helper w `tree.ts`).
- **Stale `cached_minutes`**: zawsze recalc po pull, używamy istniejącej funkcji.
- **Soft delete propagation**: row z `deleted_at` set jest normalnym recordem dla LWW — propaguje przez `updated_at`.
- **Cycle w merged tree**: matematycznie niemożliwe jeśli oba side trzymały `path` constraint, ale rebuild path detect-uje cycle (parent_id back to descendant) i abortuje merge z error log.

**Subsequent syncs:** brak. Multi-device live sync = Faza 7. Single-user typowo używa jednego urządzenia na raz.

---

## 6. Auth UI + opcjonalność

**Auth store `src/store/auth.ts`:**

```ts
type AuthState =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | { kind: 'authed'; user: User; session: Session };

type SyncStatus =
  | 'idle'
  | 'initial-pull'
  | 'syncing'
  | 'offline'
  | { error: string };

interface AuthStore {
  state: AuthState;
  syncStatus: SyncStatus;
  pendingCount: number;
  lastSyncAt: number | null;
  signIn(email, password): Promise<void>;
  signUp(email, password): Promise<void>;
  signOut(): Promise<void>;
}
```

**Komponenty:**

- `src/components/Auth/AuthGate.tsx` — badge w headerze, popover menu (Sign in / signed-in user info / Sign out)
- `src/components/Auth/AuthModal.tsx` — tabs Login / Sign up, walidacja email + min-8-char password, inline error display
- `src/components/Auth/SyncStatusBadge.tsx` — wizualny state per tabela powyżej, klik → SyncStatusModal
- `src/components/Auth/SyncStatusModal.tsx` — lista `last_error` z outbox + buttons (Retry, Clear)

**Header layout (zmienione `App.tsx`):**

```
[Projects] [Dashboard]                          [● 3 pending] [👤 user@x ▼]
```

**Opcjonalność:**

- Start app → `authStore` w `loading` → `supabase.auth.getSession()` → albo `authed` z saved session, albo `anonymous`.
- `anonymous` mode: pełna funkcjonalność Faza 1-3, outbox enqueue dzieje się ale worker idle.
- Po sign in: triggered initial pull (jeśli `hasPulledForUser` nie ma userId), worker start.
- Sign out: `supabase.auth.signOut()` → `anonymous`, worker stop. **Outbox nie czyszczony** — po relogin worker dokończy.

**Session persistence:** `@supabase/supabase-js` domyślnie używa `localStorage`. Tauri WebView wspiera localStorage per-app. Restart app przywraca sesję bez relogin.

**Env vars `.env.local` (gitignored):**

```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

`.env.example` (committed):

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

`src/lib/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.warn('[supabase] env vars missing — cloud sync disabled');
}

export const supabase = url && key
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
```

App graceful degradation: jeśli `supabase === null` (brak env vars), AuthGate ukrywa się, app pracuje w trybie Faza 1-3.

---

## 7. Testing strategy

Setup: `pnpm add -D vitest @vitest/ui happy-dom @testing-library/react`. Vitest config w `vitest.config.ts` reused vite config + setup file dla DOM.

| Warstwa | Test | Narzędzia |
|---|---|---|
| `merge.ts` LWW | local-only / cloud-only / both-equal / both-diff-time / mixed payload types | Vitest unit (pure func) |
| `outbox.ts` enqueue | każda mutacja w `queries.ts` zostawia outbox row z poprawnym payload | Vitest + in-memory better-sqlite3 mock |
| `worker.ts` flush | success → delete row; error → backoff bump; batch collapse | Vitest + msw mock supabase-js |
| `pull.ts` | recalc cached_minutes po merge, rebuild path | Vitest integration (in-memory DB) |
| Auth happy path | signup → signin → signout → resignin | manualny smoke vs Supabase prod |
| RLS | drugi user nie widzi cudzych danych | manualny: drugie konto, query w SQL editor Supabase |

Coverage target: 80%+ dla `src/lib/sync/`. Auth + UI komponenty pomijamy w coverage (manualny smoke wystarczy MVP).

---

## 8. Rollout plan (commit sequence)

Każdy commit: green typecheck + lint + (od kroku 7) tests.

1. `feat(cloud): add supabase client + env vars + auth store` — `.env.example`, `supabase.ts`, `store/auth.ts` (auth state + signIn/signUp/signOut bez UI)
2. `feat(cloud): auth modal + AuthGate badge` — komponenty UI, integracja w `App.tsx`
3. `feat(cloud): postgres schema migration + RLS` — `supabase/migrations/`, runbook w README
4. `feat(cloud): sync_outbox table + enqueue from queries` — schema bump, enqueue wszystkich mutacji
5. `feat(cloud): outbox worker with backoff + status UI` — `worker.ts`, `SyncStatusBadge`, `SyncStatusModal`
6. `feat(cloud): initial pull + LWW merge` — `merge.ts`, `pull.ts`, trigger w `onAuthStateChange`
7. `test(cloud): vitest setup + merge/outbox/pull unit tests` — `vitest.config.ts`, suite
8. `docs(cloud): update CLAUDE.md (Phase 4 done, env vars, migration runbook)`

---

## 9. Ryzyka i mitygacje

| Ryzyko | Mitygacja |
|---|---|
| `.env.local` zacommitowany | sprawdź `.gitignore` zawiera `.env.local` przed commitem #1 |
| Migracja Postgres failuje na prod | Run w SQL editor Supabase z dry-run review; trzymaj migrację idempotentną (CREATE TABLE IF NOT EXISTS niemożliwe dla RLS, więc transactional `BEGIN; ... COMMIT;` rollback on error) |
| Outbox blow up (tysiące pending) | Worker batchuje LIMIT 50, collapse duplicates per `(entity, entity_id)` przed push |
| Token expiry w środku flush | `onAuthStateChange` listener anuluje worker tick przed `SIGNED_OUT`; retry naturalnie po `TOKEN_REFRESHED` |
| LWW gubi zmiany przy clock skew | SQLite Date.now() klient, Postgres serwer TIMESTAMPTZ — oba parsowane przez `Date.parse(iso).getTime()`. Realny skew < 1min nieproblematyczny |
| User loguje na new device — locale dane przepisują cloud | LWW chroni: cloud ma większe updated_at z poprzedniej sesji → cloud wygrywa. Pusta lokalna baza = same cloud-only rows → pull writes everything |
| RLS bug pozwala cross-user query | Manualny test drugim kontem w Supabase dashboard przed merge |
| Network spike na pull (duże konto) | Faza 4 single-user, oczekujemy < 1000 rows. Faza 7 dorzuca pagination + cursor |

---

## 10. Definition of done

- [ ] Zalogowany user może utworzyć projekt → zamknąć app → otworzyć ponownie → zalogować się → projekt obecny
- [ ] Wylogowany user może używać aplikacji jak w Fazach 1-3 bez regresji (Projects + Dashboard + skróty + drag-drop + CSV)
- [ ] Drugi user (osobny account) nie widzi cudzych danych (RLS verify)
- [ ] Vitest suite green, coverage `src/lib/sync/` >= 80%
- [ ] `pnpm tauri build` produkuje msi/exe bez błędów
- [ ] CLAUDE.md zaktualizowane: Phase 4 ✓, env vars, runbook migracji, RLS policy

---

## 11. Out of scope (kolejne fazy)

- Realtime push / live multi-device sync — **Faza 7**
- Password reset, OAuth (Google/GitHub), magic link, 2FA — później (post-MVP)
- Conflict resolution UI dla user-facing diffów — **Faza 8** (offline-first hardening)
- Migracja outbox z TS do Rust async tokio task — **Faza 8**
- `workspace_id` + multi-tenant + ltree — **Faza 5**
- Storage avatarów / file uploads — **Faza 6**

---

## 12. Open TODOs (akceptowalne braki MVP)

- Password reset flow (komment placeholder w AuthModal)
- Email confirmation (disabled w Supabase Auth settings, dorobić w Fazie 9 release)
- Rate limiting po stronie klienta dla `signIn` (Supabase Auth ma swój server-side limit, więc na razie OK)
