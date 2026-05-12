# tracker — Claude Code Project Guide

Multi-tenant desktop time tracker. Tauri 2 + React 19 + TypeScript + Vite 7 + Tailwind v4 + Supabase (planned).

Pełna specyfikacja: `C:\Users\sitka\.claude\plans\specyfikacja-architektoniczna-i-logiczna-jiggly-nebula.md`

---

## Current phase

**Faza 4 — Supabase Auth + Single-User Cloud Sync (DONE).** `@supabase/supabase-js` client singleton (null when env vars missing). Zustand `useAuthStore` with `loading | anonymous | authed` states + `SyncStatus`. Header `AuthGate` (Sign in button / email dropdown) + `AuthModal` (Login/Signup tabs, email/password validation). SQLite `sync_outbox` table; every mutation in `queries.ts` enqueues a row in same transaction as write (`withTx` helper). Foreground worker (`src/lib/sync/worker.ts`) flushes every 10s + on visibility change with exponential backoff (`min(2^attempts × 1000, 300000ms)`). Partial flush: success/failure tracked per entity independently. Timestamp validation before push. First login → `runInitialPull` + LWW merge per row (`updated_at` wins) + path rebuild + cached_minutes recalc. RLS in Postgres: `user_id = auth.uid()`. Vitest + fast-check: 12 correctness properties, 60+ tests across 7 test files. Anonymous mode = pełna funkcjonalność Faz 1-3.

**Next: Faza 5 — Multi-tenant schema** (workspaces, ltree, RLS na workspace_id, invites).

---

## Stack

| Warstwa | Technologia | Wersja |
|---------|-------------|--------|
| Window/native | Tauri | 2 |
| UI | React | 19 |
| Język | TypeScript | 5.8 |
| Bundler | Vite | 7 |
| CSS | Tailwind | v4 (via `@tailwindcss/vite`) |
| Lint | ESLint flat config + typescript-eslint | 9+ |
| Format | Prettier | 3 |
| Runtime | Rust | 1.95 |
| Package manager | pnpm | 10 |
| Lokalne DB | SQLite (`tauri-plugin-sql`) | sqlx 0.8 |
| State | Zustand | 5 |
| Wykresy | Recharts | 3+ |
| Cloud BaaS | Supabase (`@supabase/supabase-js`) | 2 |
| Tests | Vitest + fast-check + Testing Library | 4+ |

Planowane (kolejne fazy): Realtime (Faza 7).

---

## How to run

```powershell
# Dev (otwiera okno Tauri z Vite HMR)
pnpm tauri dev

# Production build (msi/exe na Windows)
pnpm tauri build

# Web-only (bez Tauri, dev w przeglądarce)
pnpm dev

# Validacja
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm format      # prettier --write .
pnpm build       # tsc + vite build

pnpm test        # vitest run (all tests)
pnpm test:watch  # vitest watch mode
pnpm test:cov    # vitest run --coverage (src/lib/sync/ ≥ 80%)
```

### Cloud sync env vars (`.env.local`, gitignored)

```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Without env vars the app runs in anonymous mode (Fazy 1-3 UX). With env vars but not logged in: same UX, but Sign in button appears.

### Postgres migration (Faza 4)

1. Open Supabase SQL Editor
2. Paste `supabase/migrations/20260512000001_init.sql`
3. Run (wrapped in `BEGIN/COMMIT`, rollback on error)
4. Verify: `SELECT relrowsecurity FROM pg_class WHERE relname IN ('resources','events')` — both `true`

See `supabase/README.md` for full runbook.

### Windows dev environment — WAŻNE

Rust/Cargo wymagają **MSVC linker + Windows SDK**. Git for Windows instaluje GNU `link.exe` który shadowuje MSVC.

Dwie opcje:

**A. Stała naprawa (zalecane):** dodaj VS Build Tools do USER PATH przez `setx` w PowerShell jako admin. Wtedy `pnpm tauri dev` działa z każdego terminala.

**B. Per-session via vcvars64:** przed `pnpm tauri dev` w PowerShell:
```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
# (lub 2022 jeśli masz)
```
Łatwiej: helper script `scripts/tauri-dev.cmd` (patrz niżej).

Symptom braku MSVC: `link: extra operand ...` (Git's link.exe).
Symptom braku SDK: `LNK1181: cannot open input file 'kernel32.lib'`.

---

## Struktura folderów

```
tracker/
├── src/                    # React frontend
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css           # @import "tailwindcss"
├── src-tauri/              # Rust backend
│   ├── src/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/
├── public/                 # static assets
├── scripts/                # dev helpers
├── eslint.config.js        # flat config
├── .prettierrc.json
├── tsconfig.json           # strict + paths alias @/*
├── vite.config.ts          # @tailwindcss/vite plugin + @ alias
└── package.json
```

Aktualne (Fazy 1-4):
- `src/components/Tree/` — `TreeView`, `TreeNode`
- `src/components/Dashboard/` — `DashboardView`, `StatsCard`, `ProjectsPieChart`, `DailyBarChart`
- `src/components/` — `ContextMenu`, `PromptModal`, `ColorPickerModal`, `LogWorkModal`, `ProjectsView`
- `src/components/Auth/` — `AuthGate`, `AuthModal`, `SyncStatusBadge`, `SyncStatusModal`, `validation.ts`
- `src/lib/db/` — `schema.ts`, `types.ts`, `connection.ts`, `queries.ts` (`listEventsInRange`)
- `src/lib/utils/` — `time.ts` (parser + format), `tree.ts` (buildTree, path helpers), `uuid.ts`
- `src/lib/analytics/aggregate.ts` — `aggregate`, `daysAgoIso`, `fillDailyGaps`, `rootIdOfPath`
- `src/lib/utils/csv.ts` — `eventsToCsv`, `downloadCsv` (BOM, RFC-style escaping)
- `src/lib/hooks/useEventsRange.ts` — async fetch hook (loading/error/events)
- `src/lib/sync/` — `merge.ts`, `outbox.ts`, `worker.ts`, `pull.ts`, `types.ts`
- `src/lib/supabase.ts` — Supabase client singleton (null when env vars missing)
- `src/store/projects.ts` — Zustand store (resources, tree, expansion, CRUD + `rename` + `move`)
- `src/store/auth.ts` — Zustand auth + syncStatus store
- `supabase/migrations/` — Postgres schema + RLS
- `src/test/setup.ts` + `vitest.config.ts` — test infrastructure

Plan future folders (kolejne fazy):

---

## Conventions

- **Imports**: alias `@/` na `src/` (np. `import { foo } from "@/lib/foo"`)
- **Naming**: PascalCase komponenty React, camelCase funkcje/zmienne, kebab-case pliki nie-komponenty (`time-parser.ts`)
- **Czas**: zawsze **INTEGER minutes** w DB, nigdy float hours. Parser: `"1.5h"` / `"90m"` → minutes
- **UUID**: generated client-side (`crypto.randomUUID()`)
- **Daty**: ISO format `YYYY-MM-DD` w DB, formatowanie do UI w warstwie view
- **Soft delete**: `deleted_at TIMESTAMPTZ` zamiast hard delete (od Fazy 1)
- **Hierarchia drzewa**: materialized path TEXT w SQLite (`"id1/id2/id3"`), ltree w Postgres (Faza 5+)

## Commit convention

Conventional Commits. Scope = faza lub moduł:
- `feat(mvp): ...`
- `feat(dashboard): ...`
- `feat(cloud): ...`
- `feat(team): ...`
- `fix(scope): ...`
- `chore(scope): ...`
- `refactor(scope): ...`

Każda faza = jeden commit + update tego pliku (CLAUDE.md).

---

## Key invariants

Co MUSI zostać niezmienione przez cały projekt:
1. **Minutes INTEGER** w czasie — nigdy float hours.
2. **Materialized path / ltree** dla hierarchii — nigdy pure adjacency list.
3. **Soft delete** preferowany nad hard delete.
4. **UUID v4** dla wszystkich id (client-side gen).
5. **TypeScript strict + noUncheckedIndexedAccess**.
6. **Tailwind v4 syntax** (`@import "tailwindcss"`, nie `@tailwind base/components/utilities`).

---

## Schema (current state)

**SQLite (lokalne, Faza 1):**

```sql
CREATE TABLE resources (
  id TEXT PRIMARY KEY,                 -- UUID v4 (crypto.randomUUID)
  parent_id TEXT REFERENCES resources(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('project','stage','substage','task')),
  color TEXT,                          -- NULL = inherit from ancestor
  path TEXT NOT NULL,                  -- materialized path "id1/id2/id3"
  cached_minutes INTEGER NOT NULL DEFAULT 0,  -- sum subtree minutes (active events)
  created_at INTEGER NOT NULL,         -- ms epoch (Date.now())
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER                   -- ms epoch, NULL = active
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  date TEXT NOT NULL,                  -- ISO YYYY-MM-DD
  minutes INTEGER NOT NULL CHECK (minutes > 0),  -- NEVER float hours
  goal TEXT, topics TEXT, notes TEXT, report TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
```

DB plik: `<appDataDir>/tracker.db` (Tauri rozwiązuje per-OS).

**Cached_minutes recalc:** po insert/update/delete event funkcja `recalcCachedMinutesForResource(id)` chodzi po `path` w górę i przelicza sumę dla każdego przodka (i samego węzła) z `SUM(events.minutes) WHERE resource.path = X OR path LIKE X/%`.

---

## Architecture decisions

- **MVP-first strategy:** lokalny SQLite single-user → potem warstwa cloud. Cel: szybko działający tracker dla siebie, później team features.
- **Offline-first:** Tauri + SQLite mirror → outbox sync z Supabase (Faza 8). UI zawsze czyta z lokalnego.
- **Custom context menu w React:** blokujemy WebView default, renderujemy własne menu kontekstowe (drzewo projektów to serce aplikacji).

---

## Phased rollout (skrót)

0. **Scaffolding** ✓
1. **MVP Local** ✓ — SQLite, single-user, drzewo + log work + context menu
2. **Dashboard** ✓ — Recharts (Pie/Bar) + filtry data + projekty + stats cards
3. **Polish UX** ✓ — code-split, skróty klawiszowe, inline rename, drag-drop, CSV export
4. **Supabase Auth + single-user cloud sync** ✓ — outbox + LWW merge + RLS + Vitest PBT
5. Multi-tenant schema — workspaces, ltree, RLS
6. Team features — invites, assignments, avatary
7. Realtime + presence
8. Offline-first hardening
9. Build + release — installer, auto-updater, CI

Po każdej fazie: green build, commit, update CLAUDE.md.
