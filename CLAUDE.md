# tracker — Claude Code Project Guide

Multi-tenant desktop time tracker. Tauri 2 + React 19 + TypeScript + Vite 7 + Tailwind v4 + Supabase (planned).

Pełna specyfikacja: `C:\Users\sitka\.claude\plans\specyfikacja-architektoniczna-i-logiczna-jiggly-nebula.md`

---

## Current phase

**Faza 3 — Polish UX (DONE).** Code-split Dashboard (lazy import, initial bundle 222kB zamiast 599kB). Keyboard shortcuts (Ctrl+1/2 tabs, Ctrl+N nowy projekt, F2/Enter rename, L log work, Delete usuń). Inline rename (double-click lub F2). Drag-drop węzłów drzewa (HTML5 native, walidacja `canParent` + cycle check). CSV export eventów z dashboard. `moveResource` query + recalc cached_minutes dla obu ancestor chains.

**Next: Faza 4 — Supabase Auth + Single-User Cloud Sync** (opcjonalny backup do chmury, outbox pattern).

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

Planowane (kolejne fazy): Supabase + Auth (Faza 4), Realtime (Faza 7).

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
```

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

Aktualne (Fazy 1-2):
- `src/components/Tree/` — `TreeView`, `TreeNode`
- `src/components/Dashboard/` — `DashboardView`, `StatsCard`, `ProjectsPieChart`, `DailyBarChart`
- `src/components/` — `ContextMenu`, `PromptModal`, `ColorPickerModal`, `LogWorkModal`, `ProjectsView`
- `src/lib/db/` — `schema.ts`, `types.ts`, `connection.ts`, `queries.ts` (`listEventsInRange`)
- `src/lib/utils/` — `time.ts` (parser + format), `tree.ts` (buildTree, path helpers), `uuid.ts`
- `src/lib/analytics/aggregate.ts` — `aggregate`, `daysAgoIso`, `fillDailyGaps`, `rootIdOfPath`
- `src/lib/utils/csv.ts` — `eventsToCsv`, `downloadCsv` (BOM, RFC-style escaping)
- `src/lib/hooks/useEventsRange.ts` — async fetch hook (loading/error/events)
- `src/store/projects.ts` — Zustand store (resources, tree, expansion, CRUD + `rename` + `move`)

Plan future folders (kolejne fazy):
- `src/lib/sync/` — outbox queue (Faza 4+)
- `supabase/migrations/` — postgres migracje (Faza 4+)

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
4. Supabase Auth + single-user cloud sync
5. Multi-tenant schema — workspaces, ltree, RLS
6. Team features — invites, assignments, avatary
7. Realtime + presence
8. Offline-first hardening
9. Build + release — installer, auto-updater, CI

Po każdej fazie: green build, commit, update CLAUDE.md.
