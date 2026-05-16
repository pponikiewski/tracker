# tracker

Multi-tenant desktop time tracker. Tauri 2 + React 19 + TypeScript + Tailwind v4 + Supabase.

Offline-first SQLite mirror z cloud sync (LWW merge, outbox, realtime), auto-updater, hierarchiczne drzewo projektów, team workspace, eksport CSV/Markdown, backup JSON, local repair.

**Wersja:** 0.1.6 · **Status:** wszystkie fazy 0–9 (DONE).

## Download

Najnowszy installer dla Windows/Linux/macOS: https://github.com/pponikiewski/tracker/releases/latest

Auto-updater wykryje kolejne wersje przez `latest.json` i zainstaluje jednym klikiem.

## Features

- **Drzewo projektów** — `project → stage → substage → task` z drag-drop, inline rename, context menu, dziedziczenie koloru
- **Time logging** — INTEGER minutes, parser `"1.5h"` / `"90m"`, log modal z goal/topics/notes/report
- **Dashboard** — Recharts (pie + bar), filtry data, stats cards, eksport CSV/Markdown
- **Historia** — widok wszystkich wpisów per osoba/zakres, edycja + soft-delete
- **Multi-tenant workspace** — workspaces, memberships, role-based access, invite linki (72h)
- **Team visibility** — czas per członek, raport per projekt, eksport zespołu
- **Auth + Cloud sync** — Supabase Auth (email/pass), outbox + LWW merge, RLS na workspace_id
- **Realtime + presence** — debounced incremental pull, per-workspace presence ("X edytuje")
- **Backup + audit** — JSON eksport/restore, audit spójności drzewa, safe repair, reset lokalnej bazy
- **Auto-updater** — signed updater artifacts, GitHub Releases endpoint, NSIS installer (passive mode)
- **Profile** — display name, avatar PNG/JPEG/WebP (256KB / 2048px max), kolor inicjałów
- **i18n** — UI w języku polskim

## Stack

| Warstwa | Technologia |
|---|---|
| Native | Tauri 2 + Rust 1.95 |
| UI | React 19 + TypeScript 5.8 |
| Bundler | Vite 7 |
| Style | Tailwind v4 |
| Lokalna DB | SQLite (`tauri-plugin-sql`, sqlx 0.8) |
| Cloud | Supabase (Auth + Postgres + Realtime + Storage) |
| State | Zustand 5 |
| Charts | Recharts 3 |
| Tests | Vitest 4 + fast-check + Testing Library |

## Dev quick start

```powershell
pnpm install

# Dev (Windows — najpierw setup MSVC env, patrz CLAUDE.md)
scripts\tauri-dev.cmd

# Lub web-only (bez Tauri)
pnpm dev

# Validation
pnpm typecheck
pnpm lint
pnpm test
pnpm test:cov

# Production build
scripts\tauri-build.cmd
```

### Supabase env (`.env.local`, gitignored)

```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Bez env vars aplikacja działa w trybie anonimowym (tylko lokalna SQLite, bez cloud).

### Dev requirements

- Node 22+, pnpm 10+
- Rust 1.95+ (`rustup install stable`)
- **Windows:** VS Build Tools 2019/2022 z workload **"Desktop development with C++"** (zawiera Windows SDK)
- WebView2 (preinstalowany w Win11)

Szczegóły konfiguracji + troubleshooting MSVC: `CLAUDE.md`.

## Database migrations

Supabase migrations w `supabase/migrations/` — uruchamiane w SQL Editor w kolejności daty:

```
20260512000001_init.sql
20260601000001_multi_tenant_schema.sql
20260615000001_team_features.sql
...
20260725000001_profiles_auto_create.sql
20260725000002_profiles_avatar_color.sql
```

## Release

Bump wersji w `package.json` + `src-tauri/tauri.conf.json` + `src-tauri/Cargo.toml` → commit → tag `vX.Y.Z` → push tag. GitHub Actions buduje + uploada draft release. Publish → auto-updater odpala u userów.

Pełny runbook: `docs/release.md`.

## Docs

- `CLAUDE.md` — pełna specyfikacja, fazy, invariants, troubleshooting
- `AGENTS.md` — guidelines dla AI agents
- `docs/release.md` — release runbook
- `supabase/README.md` — Supabase setup

## License

Prywatny projekt.
