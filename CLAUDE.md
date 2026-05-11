# tracker — Claude Code Project Guide

Multi-tenant desktop time tracker. Tauri 2 + React 19 + TypeScript + Vite 7 + Tailwind v4 + Supabase (planned).

Pełna specyfikacja: `C:\Users\sitka\.claude\plans\specyfikacja-architektoniczna-i-logiczna-jiggly-nebula.md`

---

## Current phase

**Faza 0 — Scaffolding (DONE).** Tauri + React + TS + Tailwind + ESLint + Prettier działa, build zielony.

**Next: Faza 1 — MVP Local** (single-user SQLite, brak auth, drzewo projektów + logowanie czasu).

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

Planowane (kolejne fazy): SQLite (`tauri-plugin-sql`), Recharts, shadcn/ui, Supabase, Realtime.

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

Plan future folders (kolejne fazy):
- `src/components/Tree/` — drzewo projektów
- `src/components/LogWork/` — modal logowania
- `src/lib/db/` — SQLite wrapper (Faza 1)
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

**Faza 0:** brak DB.

**Faza 1 (next):** SQLite local — patrz spec `## Faza 1 — MVP Local` w pliku planu.

---

## Architecture decisions

- **MVP-first strategy:** lokalny SQLite single-user → potem warstwa cloud. Cel: szybko działający tracker dla siebie, później team features.
- **Offline-first:** Tauri + SQLite mirror → outbox sync z Supabase (Faza 8). UI zawsze czyta z lokalnego.
- **Custom context menu w React:** blokujemy WebView default, renderujemy własne menu kontekstowe (drzewo projektów to serce aplikacji).

---

## Phased rollout (skrót)

0. **Scaffolding** ✓
1. MVP Local — SQLite, single-user, drzewo + log work
2. Dashboard — Recharts + filtry
3. Polish UX — skróty, drag-drop, CSV, dark mode
4. Supabase Auth + single-user cloud sync
5. Multi-tenant schema — workspaces, ltree, RLS
6. Team features — invites, assignments, avatary
7. Realtime + presence
8. Offline-first hardening
9. Build + release — installer, auto-updater, CI

Po każdej fazie: green build, commit, update CLAUDE.md.
