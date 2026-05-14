# tracker — Claude Code Project Guide

Multi-tenant desktop time tracker. Tauri 2 + React 19 + TypeScript + Vite 7 + Tailwind v4 + Supabase (planned).

Pełna specyfikacja: `C:\Users\sitka\.claude\plans\specyfikacja-architektoniczna-i-logiczna-jiggly-nebula.md`

---

## Current phase

**Faza 6 — Minimum Team Visibility (DONE).** Projekt jest teraz prostym trackerem dla Ciebie i małego zespołu: wspólny workspace, eventy przypisane do autora, widok czasu per osoba, podstawowy Team report i stabilny sync bez pełnego SaaS/realtime.

Kluczowe zmiany Fazy 6:

- **Event attribution**: lokalne `events.user_id` zapisuje autora logu; nowe logi biorą `user.id` z auth store
- **Team visibility**: `TeamView` pokazuje czas per członek workspace'u, zakres dat i rozbicie per projekt
- **Team report export**: eksport CSV i Markdown z widoku Team (`teamRowsToCsv`, `teamRowsToMarkdown`)
- **Workspace-scoped dashboard**: zakres eventów w dashboardzie jest zawężony do aktywnego workspace'u
- **Profiles**: `profiles` w Supabase + lokalny `profiles_cache`; UI korzysta z display name i opcjonalnego avatara
- **Assignments pomocnicze**: `assignments` są synchronizowane i używane do filtrowania/przypisań, ale nie są centrum produktu
- **Supabase migration**: `supabase/migrations/20260615000001_team_features.sql` dodaje `profiles`, `assignments`, indeksy, RLS i opcjonalny bucket `avatars`
- **Sync fixes**: pull zachowuje `workspace_id` dla resources/events i synchronizuje team entities bez mieszania workspace'ów
- **Testy**: dodane testy agregacji zespołu i eksportów raportu
- **UI redesign**: górny pasek nawigacji zastąpiony stałym lewym sidebarem z workspace switcherem, ikonami, sync statusem i kontem
- **History view**: nowy widok historii logów czasu z filtrem osoby/zakresu dat oraz edycją i soft-delete wpisów

Poprzednia Faza 5 — Multi-Tenant Schema (DONE). Model multi-tenant oparty na Workspace'ach. Każdy Resource i Event należy do dokładnie jednego Workspace. Kluczowe zmiany:

- **Workspace model**: tabele `workspaces` i `workspace_memberships` w SQLite i Postgres; kolumna `workspace_id` w `resources` i `events`
- **Local_Personal_Workspace**: stabilne UUID generowane raz, przechowywane w `kv_store` (SQLite), nigdy nie synchronizowane z Supabase — używane w trybie anonimowym
- **Personal_Workspace**: tworzony automatycznie przy pierwszym logowaniu (`name = "My workspace"`) przez `ensurePersonalWorkspace()` w `pull.ts`
- **ltree w Postgres**: migracja `path TEXT → ltree` z indeksem GiST; konwersja przez `pathToLtree`/`ltreeToPath` w `src/lib/utils/ltree.ts` (zamiana `-↔_` i `/↔.`)
- **RLS na workspace_id**: funkcja `is_workspace_member(workspace_id UUID)` zastępuje `user_id = auth.uid()`; polityki na `workspaces`, `workspace_memberships`, `resources`, `events`, `invites`
- **Sync outbox**: rozszerzony o encje `'workspace'` i `'workspace_membership'`; `mapWorkspaceToCloud` (bez `user_id`, workspace ma `owner_id`); `workspace_membership` z `op='delete'` → `.delete().match()`
- **Initial Pull**: workspace'y pobierane PRZED resources/events (FK constraint); błąd fetcha workspace'ów → stop (nie pobiera resources/events)
- **WorkspaceStore** (`src/store/workspace.ts`): Zustand store z pełnym CRUD, `setActiveWorkspace` + `localStorage`, `restoreActiveWorkspace`, `removeMember` (Supabase first, SQLite second), invite management
- **Invite flow**: tabela `invites` tylko w Supabase (efemeryczne); token UUID, 72h expiry; `InviteAcceptView` z URL token detection
- **UI**: `WorkspaceSwitcher` w headerze (anonymous/single/multi mode), `WorkspaceSettingsPanel` (role-based visibility), `WorkspaceCreateModal`, `InviteAcceptView`
- **SQLite migration**: `SCHEMA_V5_SQL` w `schema.ts`; `runPhase5Migration()` w `connection.ts` (idempotentna przez `PRAGMA table_info`); odtworzenie `sync_outbox` przez CREATE/INSERT/DROP/RENAME (SQLite nie obsługuje ALTER COLUMN)
- **Postgres migration**: `supabase/migrations/20260601000001_multi_tenant_schema.sql` — ltree extension, workspaces, workspace_memberships, backfill, workspace_id w resources/events, invites, RLS
- **Testy PBT**: 8 nowych właściwości (Properties 1–4, 9, 10, 13) — ltree round-trip, pathToLtree correctness, error rejection, workspace name validation, LWW merge dla workspace'ów, timestamp conversion, outbox collapse

**Next: Faza 7 — Realtime + presence** jest świadomie odłożona. Najpierw priorytetem jest używanie przez mały zespół, backup/export i stabilność sync.

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

Aktualne (Fazy 1-5):
- `src/components/Tree/` — `TreeView`, `TreeNode`
- `src/components/Dashboard/` — `DashboardView`, `StatsCard`, `ProjectsPieChart`, `DailyBarChart`
- `src/components/History/` — `HistoryView`
- `src/components/Sidebar/` — `Sidebar`
- `src/components/` — `ContextMenu`, `PromptModal`, `ColorPickerModal`, `LogWorkModal`, `ProjectsView`
- `src/components/Auth/` — `AuthGate`, `AuthModal`, `SyncStatusBadge`, `SyncStatusModal`, `validation.ts`
- `src/components/Workspace/` — `WorkspaceSwitcher`, `WorkspaceSettingsPanel`, `WorkspaceCreateModal`, `InviteAcceptView`
- `src/lib/db/` — `schema.ts` (SCHEMA_SQL + SCHEMA_V5_SQL), `types.ts`, `connection.ts` (runPhase5Migration), `queries.ts`, `workspaceQueries.ts`
- `src/lib/utils/` — `time.ts`, `tree.ts`, `uuid.ts`, `ltree.ts` (pathToLtree, ltreeToPath), `history.ts` (groupEventsByDate, dayGroupLabel, formatTimestamp)
- `src/lib/analytics/aggregate.ts`
- `src/lib/utils/csv.ts`
- `src/lib/hooks/useEventsRange.ts`
- `src/lib/sync/` — `merge.ts`, `outbox.ts`, `worker.ts` (workspace entities), `pull.ts` (ensurePersonalWorkspace), `types.ts`
- `src/lib/supabase.ts`
- `src/store/projects.ts` — workspace-scoped queries
- `src/store/auth.ts`
- `src/store/workspace.ts` — WorkspaceStore (Zustand)
- `supabase/migrations/` — `20260512000001_init.sql` (Faza 4), `20260601000001_multi_tenant_schema.sql` (Faza 5), `20260615000001_team_features.sql` (Faza 6)
- `src/test/setup.ts` + `vitest.config.ts`

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
5. **Multi-tenant schema** ✓ — workspaces, ltree, RLS na workspace_id, invites, WorkspaceStore, UI
6. **Minimum Team Visibility** ✓ — profiles, event author, TeamView, team report CSV/Markdown, assignments pomocnicze
7. Realtime + presence — odłożone do czasu realnego bólu zespołu
8. Offline-first hardening — backup/export/restore, sync audit, testy awarii
9. Build + release — installer, auto-updater, CI

Po każdej fazie: green build, commit, update CLAUDE.md.
