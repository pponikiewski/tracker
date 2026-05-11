# tracker

Multi-tenant desktop time tracker. Tauri 2 + React 19 + Tailwind v4 + Supabase (planned).

## Status

**Faza 2 — Dashboard (DONE).** Faza 3 (UX polish) — next.

Pełny roadmap: `CLAUDE.md` → sekcja "Phased rollout".

## Quick start

```powershell
pnpm install

# Dev (Windows — najpierw setup MSVC env, patrz CLAUDE.md)
scripts\tauri-dev.cmd

# Lub web-only
pnpm dev

# Build production
scripts\tauri-build.cmd
```

## Dev requirements

- Node 22+, pnpm 10+
- Rust 1.95+ (`rustup install stable`)
- **Windows:** VS Build Tools 2019/2022 z workload **"Desktop development with C++"** (zawiera Windows SDK)
- WebView2 (preinstalowany w Win11)

Szczegóły konfiguracji: `CLAUDE.md`.

## Stack docs

- Tauri: https://tauri.app
- Vite: https://vite.dev
- Tailwind v4: https://tailwindcss.com
