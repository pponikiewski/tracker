# Plan poprawek po audycie

Źródło: audyt 2026-05-16. Priorytety P0 → P2.

---

## P0 — Krytyczne (1–2 dni)

### P0.1 — Single Rust connection pool

**Problem:** każda komenda `connect(&app).await?` otwiera nowe SQLite connection. Plugin-sql trzyma własne. Dwa writery → lock contention, `SQLITE_BUSY`.

**Pliki:**
- `src-tauri/src/lib.rs` — wprowadź `tauri::State<SqlitePool>`
- `src-tauri/Cargo.toml` — `sqlx` już jest

**Zmiany:**
```rust
// w run()
.setup(|app| {
    let path = db_path(app.handle())?;
    let opts = SqliteConnectOptions::from_str(&path.to_string_lossy())?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
    let pool = tauri::async_runtime::block_on(
        SqlitePoolOptions::new().max_connections(4).connect_with(opts)
    )?;
    app.manage(pool);
    Ok(())
})
```

Commands biorą `State<'_, SqlitePool>` zamiast `AppHandle`. Wywal `connect()` helper.

**Decyzja:** zostawiamy `tauri-plugin-sql` tylko do SELECT z TS, czy eliminujemy? Rekomendacja — eliminuj, przepisz odczyty na commands (`list_resources_tx`, `list_events_range_tx`). Spójność > wygoda.

**Test:** `pnpm test` + manual drag-drop 50 nodów → brak SQLITE_BUSY w logach.

---

### P0.2 — Walidacja input w Rust

**Problem:** `name: String` bez `trim()`, bez limitu długości. Frontend nie jest jedynym źródłem prawdy.

**Pliki:**
- `src-tauri/src/lib.rs` — top każdej komendy

**Wzorzec:**
```rust
fn validate_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() { return Err("name required".into()); }
    if trimmed.len() > 256 { return Err("name too long (max 256)".into()); }
    Ok(trimmed.to_string())
}

fn validate_text_field(value: &Option<String>, max: usize, field: &str) -> Result<(), String> {
    if let Some(v) = value {
        if v.len() > max { return Err(format!("{field} too long (max {max})")); }
    }
    Ok(())
}
```

Stosuj w `create_resource_tx`, `rename_resource_tx`, `create_event_tx`, `update_event_tx`, `create_workspace_tx`.

Limity:
- `name`: 256
- `goal`, `topics`: 512
- `notes`, `report`: 8192
- `minutes`: już `CHECK > 0` w schemacie, dodaj `< 24*60*30` (30 dni jako rozsądny max)

---

### P0.3 — NaN guard w lwwMerge

**Plik:** `src/lib/sync/merge.ts`

**Zmiana:**
```ts
const toMs = (v: number | string): number => {
  const n = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(n)) {
    throw new Error(`invalid LWW timestamp: ${JSON.stringify(v)}`);
  }
  return n;
};
```

**Callsite:** `src/lib/sync/pull.ts` — opakuj `lwwMerge()` w `try/catch`, na error skip wiersz i loguj `console.warn`. Albo lepiej: filter cloudRows przed merge'em, drop te z nievalid `updated_at`, push do telemetrii.

**Test:** dodaj fast-check property w `__tests__/merge.test.ts` — random invalid timestamp → throw, brak silent no-op.

---

### P0.4 — maxWait w Realtime debounce

**Plik:** `src/lib/sync/realtime.ts`

**Problem:** ciągły strumień zmian → debounce nigdy nie wystrzeli → 120s czekania na fallback poll.

**Zmiana:**
```ts
const DEBOUNCE_MS = 400;
const MAX_WAIT_MS = 2000;
let firstScheduledAt = 0;

function schedulePull(): void {
  const now = Date.now();
  if (!firstScheduledAt) firstScheduledAt = now;
  if (debounceTimer) clearTimeout(debounceTimer);
  const elapsed = now - firstScheduledAt;
  const wait = Math.max(0, Math.min(DEBOUNCE_MS, MAX_WAIT_MS - elapsed));
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    firstScheduledAt = 0;
    void (async () => {
      const { pullNow } = await import('./worker');
      await pullNow();
    })();
  }, wait);
}
```

**Test:** unit test — 100 wywołań `schedulePull` w 50ms intervals → pull odpala ≤ 2050ms od pierwszego call.

---

### P0.5 — Realtime disconnect → fast-poll fallback

**Pliki:**
- `src/lib/sync/realtime.ts`
- `src/lib/sync/worker.ts`

**Problem:** ws drop → 120s cisza zanim fallback poll.

**Zmiana w `realtime.ts`:**
```ts
let onDisconnected: (() => void) | null = null;

export function setDisconnectHandler(fn: () => void): void {
  onDisconnected = fn;
}

// w subscribe callback:
channel = ch.subscribe((status) => {
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    console.warn(`[realtime] ${status} — switching to fast-poll`);
    onDisconnected?.();
  }
});
```

**Zmiana w `worker.ts`:**
```ts
const PULL_INTERVAL_NORMAL = 120_000;
const PULL_INTERVAL_DEGRADED = 15_000;
let pullInterval = PULL_INTERVAL_NORMAL;

function restartPullTimer(intervalMs: number): void {
  if (pullTimer) clearInterval(pullTimer);
  pullInterval = intervalMs;
  pullTimer = setInterval(() => void pullNow(), intervalMs);
}

// w startWorker:
const { setDisconnectHandler, startRealtime } = await import('./realtime');
setDisconnectHandler(() => {
  if (pullInterval !== PULL_INTERVAL_DEGRADED) {
    restartPullTimer(PULL_INTERVAL_DEGRADED);
    void pullNow();
    // próbuj reconnect co minutę
    setTimeout(() => startRealtime(), 60_000);
  }
});
```

Po udanym subscribe (`status === 'SUBSCRIBED'`) wróć do `PULL_INTERVAL_NORMAL`.

---

## P1 — Średnie (tydzień 2–3)

### P1.1 — Modularyzacja `src-tauri/src/lib.rs`

**Problem:** 1462 LOC w jednym pliku. Rekompilacja całości na każdą zmianę.

**Docelowa struktura:**
```
src-tauri/src/
├── main.rs
├── lib.rs              # run() + invoke_handler! tylko
├── db/
│   ├── mod.rs          # pool, connect, fetch_resource, fetch_event, fetch_assignment
│   ├── activity.rs     # ActivityRow, insert_activity
│   └── outbox.rs       # enqueue_payload
├── domain/
│   ├── mod.rs
│   ├── hierarchy.rs    # can_parent, is_descendant_path, resource_label
│   ├── resource.rs     # ResourceRow, create/rename/color/move/delete commands
│   ├── event.rs        # EventRow, create/update/delete commands
│   └── workspace.rs    # WorkspaceRow, MembershipRow, create command
└── recalc.rs           # recalc_ancestor_chain
```

**Kolejność migracji:**
1. Wyciągnij `ResourceRow`, `EventRow`, `WorkspaceRow`, `MembershipRow`, `AssignmentRow`, `ActivityRow` → `db/mod.rs`
2. Wyciągnij `fetch_*` helpery → `db/mod.rs`
3. Wyciągnij `enqueue_payload`, `is_local_workspace` → `db/outbox.rs`
4. Wyciągnij `insert_activity` → `db/activity.rs`
5. Wyciągnij `can_parent`, `is_descendant_path`, `resource_label` → `domain/hierarchy.rs`
6. Każda grupa commands do osobnego pliku
7. `lib.rs` ma już tylko `run()` + handler list

**Test:** `cargo build` po każdym kroku. Brak zmian funkcjonalnych.

---

### P1.2 — Refaktor `ProjectsView.tsx`

**Problem:** 521 LOC — keyboard, drag-drop, context menu, modale, presence broadcast wszystko inline.

**Docelowa struktura:**
```
src/components/Projects/
├── ProjectsView.tsx           # ~150 LOC, kompozycja
├── hooks/
│   ├── useProjectsKeyboard.ts # Ctrl+N, N, E, Z, L, K, Del, Esc
│   ├── useProjectsDragDrop.ts # canDropOn, handleDragOver, handleDrop
│   └── usePresenceBroadcast.ts # setEditing efekt
└── modals/
    └── ProjectsModalManager.tsx # CreateModal, ColorPicker, LogWork, Prompt
```

**Test:** pełen pass `pnpm test`, manual smoke test wszystkich skrótów.

---

### P1.3 — Inkrementalny pull z kursorem

**Problem:** każdy pull = `SELECT *` z 6 tabel cloud + 6 tabel lokal. Nie skaluje.

**Pliki:**
- `src/lib/sync/pull.ts`
- `supabase/migrations/<new>.sql` — indeksy jeśli brak

**Schemat:**
```ts
// nowy klucz w kv_store: last_pulled_at_<table>
async function getCursor(db: Database, table: string): Promise<string | null> {
  const r = await db.select<Array<{value: string}>>(
    "SELECT value FROM kv_store WHERE key = $1 LIMIT 1",
    [`last_pulled_at_${table}`]
  );
  return r[0]?.value ?? null;
}

async function setCursor(db: Database, table: string, ts: string): Promise<void> {
  await db.execute(
    "INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [`last_pulled_at_${table}`, ts]
  );
}

// w runPull:
const cursor = await getCursor(db, 'resources');
const query = supabase.from('resources').select('*');
if (cursor && !isInitial) query.gt('updated_at', cursor);
const { data: cloudR, error } = await query;
// po sukcesie merge — zapisz max(updated_at) z cloudR jako nowy kursor
```

**Initial pull** ignoruje kursor (pełne pobranie).
**Incremental pull** używa kursora.

**Indeksy Postgres** (jeśli brak):
```sql
CREATE INDEX IF NOT EXISTS idx_resources_updated_at ON resources(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_events_updated_at ON events(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_assignments_updated_at ON assignments(workspace_id, updated_at);
```

**Edge case:** soft-delete (`deleted_at` ustawiony) musi mieć też `updated_at` bumped — sprawdzić wszystkie soft-delete paths.

**Test:** new PBT property — initial pull + N incremental pull = idempotent (final state taki sam jak po N+1 incremental pull z empty cursor).

---

### P1.4 — Server-time LWW

**Problem:** `Date.now()` per klient → clock skew → wrong winner.

**Plik:** `src/lib/sync/worker.ts`

**Zmiana:** po upsert do Supabase użyj `returning=representation`:
```ts
const { data, error } = await supabase
  .from(table)
  .upsert(mapped, { onConflict: 'id' })
  .select(); // zwraca rows z server-side updated_at

if (!error && data) {
  // zapisz server updated_at z powrotem do local SQLite
  for (const cloudRow of data) {
    await db.execute(
      `UPDATE ${table} SET updated_at = $1 WHERE id = $2`,
      [Date.parse(cloudRow.updated_at), cloudRow.id]
    );
  }
}
```

**Caveat:** Postgres trigger który ustawia `updated_at = NOW()` musi istnieć po stronie cloud (sprawdź migrations). Jeśli nie, dodaj.

**Test:** integration test z mockiem dwóch klientów z różnymi clock offsetami.

---

### P1.5 — Deklaratywny migration runner

**Problem:** 7 osobnych `ensureXyz()` funkcji w `connection.ts`. Brak deklaratywnej listy.

**Plik:** `src/lib/db/connection.ts`, nowy `src/lib/db/migrations.ts`

**Wzorzec:**
```ts
// migrations.ts
export interface Migration {
  version: string;
  up: (db: Database) => Promise<void>;
}

export const MIGRATIONS: Migration[] = [
  {
    version: '20260512000001_mvp',
    up: async (db) => { await db.execute(SCHEMA_SQL); },
  },
  {
    version: '20260601000001_multi_tenant',
    up: async (db) => { await runPhase5Migration(db); },
  },
  // ...
];

// connection.ts
async function runMigrations(db: Database): Promise<void> {
  await ensureSchemaMigrationsTable(db);
  const applied = new Set(
    (await db.select<Array<{version: string}>>('SELECT version FROM schema_migrations'))
      .map((r) => r.version)
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    console.info(`[db] applying migration ${m.version}`);
    await m.up(db);
    await markSchemaMigration(db, m.version);
  }
}
```

**Korzyść:** wszystkie migracje w jednym pliku, deklaratywnie. Dodanie nowej = dopisanie obiektu. Brak `ensureXyz()` rozsianych po codebase.

---

## P2 — Później (1–2 miesiące)

### P2.1 — SQL-side LWW merge

Zamiast pobierać local+cloud do JS i mergować, zrób:
```sql
INSERT INTO resources (id, ...)
VALUES ($1, ...)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  updated_at = excluded.updated_at,
  ...
WHERE excluded.updated_at > resources.updated_at;
```

Batch insert N rows = jedna komenda. Eliminuje walk po JS arrays.

**Pliki:** `src/lib/sync/pull.ts`, nowe `src/lib/db/upsertBatch.ts`

---

### P2.2 — Outbox worker w Rust

**Korzyść:** działa nawet jak WebView freeze. Lepsza wydajność (brak boundary crossing TS↔Rust per row).

**Wymagane:**
- `reqwest` lub `supabase-rs` w Cargo.toml
- Auth token sharing TS → Rust (przez `app.manage(AuthState)`)
- Emit `tauri://event` `sync-status-changed` zamiast pollowania z TS

**Skomplikowane** — nie wcześniej niż po P0/P1.

---

### P2.3 — Typed Rust errors

```rust
#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    #[error("validation: {0}")]
    Validation(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("database: {0}")]
    Database(String),
}
```

Commands zwracają `Result<(), AppError>`. Frontend dostaje strukturyzowany error → możliwa i18n po stronie UI.

**Wymaga:** `thiserror` w Cargo.toml.

---

### P2.4 — E2E testy

Playwright via Tauri webdriver lub `@tauri-apps/cli` test runner.

**Golden path scenarios:**
1. Login → create workspace → create project → log work → assert dashboard total
2. Multi-window (dwóch userów na test seed) → user A loguje czas → user B widzi w team view
3. Offline mode: rozłącz net → log work → reconnect → outbox flush → cloud ma rekord
4. Drag-drop: przenieś task z stage A do stage B → assert path zmieniony, cached_minutes recalc poprawny

---

### P2.5 — Drobne

- `getDb()` close on signOut
- `presence.ts` reset `currentEditing` w `stop()`
- Cache `isLocalWorkspaceId` (Set ładowany raz)
- `auth.ts` unsubscribe handle przechowany — cleanup na shutdown
- `recalc_ancestor_chain` batch via CTE zamiast N queries
- Dodaj `ts-prune` lub `knip` do `pnpm lint` chain
- `tauri.conf.json` — minWidth/minHeight, prod CSP bez `http://localhost:1420`

---

## Kolejność wykonania

```
P0.1 (pool)          ─┐
P0.2 (validation)     │ Tydzień 1
P0.3 (NaN merge)      │
P0.4 (debounce)       │
P0.5 (ws fallback)   ─┘

P1.1 (modularyzacja Rust) ─┐
P1.2 (refaktor Projects)   │ Tydzień 2–3
P1.5 (migration runner)   ─┘

P1.3 (incremental pull) ─┐
P1.4 (server-time LWW)   │ Tydzień 4
                        ─┘

P2.* — po zakończeniu P0+P1
```

## Definition of Done

- Wszystkie testy zielone (`pnpm test`)
- `pnpm typecheck` clean
- `pnpm lint` clean
- Manual smoke test w `pnpm tauri dev`: login → workspace → project → log → drag-drop → offline/online cycle
- `cargo build --release` zielony
- CLAUDE.md zaktualizowany — nowa sekcja "Audit fixes" z linkiem do tego dokumentu
- Commit per P0.X / P1.X (granularnie, dla łatwego rollback)
