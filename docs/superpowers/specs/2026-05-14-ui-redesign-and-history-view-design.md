# UI Redesign + History View — Design Spec

**Date:** 2026-05-14
**Status:** Approved (design), pending implementation plan
**Scope:** Single implementation plan — UI shell redesign + new History view with edit/delete

---

## Goal

Make tracker look as simple, minimal, and intuitive as possible — no learning curve.
Two changes:

1. **UI shell redesign** — replace the top `<nav>` bar with a fixed left sidebar; reduce per-view header clutter.
2. **New History view** — a chronological feed of every time-log entry (who, what, when), with edit and delete.

Non-goals: realtime/presence (Faza 7), restyling individual modals beyond what the new view needs, theme/color-scheme change (dark neutral palette stays).

---

## Part 1 — UI Shell Redesign

### Current state

`src/App.tsx` renders a 48px top `<nav>`: logo, tab pill group (Projekty / Raporty / Zespół), `WorkspaceSwitcher`, `SyncStatusBadge`, `AuthGate`. Content area below. Each view (`ProjectsView`, `DashboardView`, `TeamView`) renders its own header; `ProjectsView` additionally shows a keyboard-shortcuts hint row and a `Faza 6 · Team visibility` footer.

### Target: fixed left sidebar (Layout C)

The top `<nav>` is removed entirely. App shell becomes a horizontal flex: fixed-width sidebar (`~188px`, `w-47`/explicit) + flex-1 content.

Sidebar structure, top to bottom:

1. **Logo** — `T` badge + `tracker` wordmark.
2. **WorkspaceSwitcher** — moved here, directly under logo. Component reused as-is; only container styling adjusted to fit a vertical column.
3. **Nav list** — `Projekty`, `Raporty`, `Historia`, `Zespół`. Each item: `lucide-react` icon + label. Active item highlighted (filled background, as the current active tab pill is). `Zespół` still conditionally rendered when `showTeamTab` is true.
4. **Spacer** (`mt-auto`).
5. **Footer block** — `SyncStatusBadge` + `AuthGate`, stacked compactly, separated by a top border.

Sidebar is **fixed** — always visible, not collapsible.

### Icons

Add `lucide-react` dependency. Nav icons:

| Nav item | Icon |
|----------|------|
| Projekty | `FolderTree` |
| Raporty  | `BarChart3` |
| Historia | `History` |
| Zespół   | `Users` |

### Keyboard shortcuts

Preserved. `Ctrl+1` → Projekty, `Ctrl+2` → Raporty, `Ctrl+3` → Historia, `Ctrl+4` → Zespół (Zespół only when visible). The `App.tsx` keydown handler is updated for the new tab and the new ordering.

### Tab state

`App.tsx` `Tab` type extends to `"projects" | "dashboard" | "history" | "team"`. The "fall back to projects when Team hidden" effect stays. `HistoryView` is lazy-loaded like `DashboardView`/`TeamView`.

### Per-view header pattern (B)

Every view header is normalized to: **title + light stat subtitle + primary action button**. Specifically:

- `ProjectsView`: keep title, keep the stat subtitle (`{workspace} · {n} elementów · {min} min`), keep `Nowy projekt` button. **Remove** the keyboard-shortcuts hint row and the `Faza 6` footer. The assignment filter bar stays (it is a feature, and is already hidden for local/solo workspaces).
- `DashboardView`, `TeamView`: confirm they follow the same title + light-stat + action shape; trim any decorative footer/hint rows to match. No functional change to their charts/data.

---

## Part 2 — History View

### Purpose

A single place to see every time-log entry in the active workspace: who logged it, against which resource, how much time, what they wrote (goal/topics/notes/report), the date it is logged for, and when it was actually entered. Entries can be edited and deleted.

### Component

New `src/components/History/HistoryView.tsx`, lazy-loaded from `App.tsx`.

Header (pattern B): title `Historia` + stat subtitle (`{n} wpisów · {sum} min`) + filter controls (person + date range, top-right). No "new" button — entries are created from the tree, not here.

### Data

New query in `src/lib/db/queries.ts`, e.g. `listEventsForHistory(workspaceId, fromIso, toIso, userId?)`:

- Returns `EventWithResource[]` (already defined: `TimeEvent` + `resource_name` + `resource_path`).
- `JOIN resources r ON r.id = e.resource_id`, `WHERE e.deleted_at IS NULL AND r.deleted_at IS NULL AND e.workspace_id = $1 AND e.date BETWEEN ... `, optional `AND e.user_id = $userId`.
- `ORDER BY e.date DESC, e.created_at DESC` — newest log-date group first, and within a day the most-recently-entered first. This differs from `listEventsInRange` (orders by `e.date` ascending for charts); keep both, do not repurpose `listEventsInRange`.

Author display name + avatar come from `useProfileStore().getProfile(user_id)` (same pattern as `ProjectsView` / `TeamView`). Entries with `user_id === null` (anonymous/local) show a neutral "—" author.

### Layout

Entries grouped by **log date** (`event.date`), newest group first. Group headers: `Dziś`, `Wczoraj`, otherwise the formatted date.

Each entry is a card:

- **Top row:** author avatar + display name, resource path (`resource_path` → human-readable via existing tree/path utils, or `resource_name` with ancestor names), and `minutes` right-aligned.
- **Body:** only the filled fields among `goal` / `topics` / `notes` / `report`, each with a small label. Empty fields are omitted entirely.
- **Footer row:** `log na {event.date}` · `wpisano {created_at formatted}`. If `updated_at > created_at`, append `· edytowano ({updated_at formatted})`.
- **Actions:** edit + delete (icon buttons or a small menu on the card).

### Filters

- **Person** — `Wszyscy` / each workspace member (from `memberships` + `getProfile`). For solo/local workspace the person filter may be hidden or just show the single user.
- **Date range** — same control style as `DashboardView`. Default: last 30 days.

Filters re-run the query. Filter state resets on workspace change (same `useEffect` pattern as `ProjectsView`'s assignment filter).

### Edit

Reuses `LogWorkModal`. The modal currently only supports create (`resource` prop + `onSubmit` with no id). It is extended to an optional edit mode:

- New optional prop carrying an existing `TimeEvent` (e.g. `event?: TimeEvent`). When present, the form initializes from that event's fields instead of blank/`todayIso()`, the heading reads `Edytuj wpis`, and `onSubmit` is wired to an update path.
- `HistoryView` passes the event and an `onSubmit` that calls a new `updateEvent(...)` query.

New `updateEvent` in `queries.ts`:

- `UPDATE events SET date, minutes, goal, topics, notes, report, updated_at = now() WHERE id = $id` (inside `withTx`).
- If `minutes` or `date` changed, call `recalcCachedMinutesForResource(resource_id)`.
- Re-select the row and `enqueue(db, "event", id, "upsert", row)` for sync — mirrors `createEvent`.
- The bumped `updated_at` (now `> created_at`) is what drives the `edytowano (...)` marker in the UI.

### Delete

New `deleteEvent` in `queries.ts`:

- Soft delete: `UPDATE events SET deleted_at = now(), updated_at = now() WHERE id = $id` (inside `withTx`) — consistent with the soft-delete invariant.
- Call `recalcCachedMinutesForResource(resource_id)` so the removed minutes drop out of `cached_minutes` and therefore out of all rollups/reports.
- Re-select the row and `enqueue(db, "event", id, "upsert", row)` — the sync layer already handles a soft-deleted event as an upsert with `deleted_at` set (same as resources).
- UI: confirm before deleting (small inline confirm or reuse an existing confirm pattern), then drop the card from the list.

### Store wiring

`updateEvent` / `deleteEvent` are exposed through the projects store (or a small dedicated hook used by `HistoryView`), so the tree's `cached_minutes` and any open `ProjectsView` refresh consistently after an edit/delete. Reuse the existing `refresh()` mechanism.

---

## Affected files

**Modified:**
- `src/App.tsx` — remove top nav, render sidebar shell, add `history` tab + lazy `HistoryView`, update keyboard shortcuts.
- `src/components/ProjectsView.tsx` — remove kbd hint row + `Faza 6` footer; header unchanged otherwise.
- `src/components/Dashboard/DashboardView.tsx`, `src/components/Team/TeamView.tsx` — normalize header to pattern B, trim decorative footers/hints.
- `src/components/LogWorkModal.tsx` — optional edit mode (`event?` prop, init from event, `Edytuj wpis` heading).
- `src/lib/db/queries.ts` — add `listEventsForHistory`, `updateEvent`, `deleteEvent`.
- `src/store/projects.ts` (or new hook) — expose `updateEvent` / `deleteEvent`.
- `package.json` — add `lucide-react`.
- `CLAUDE.md` — document the new view + folder.

**New:**
- `src/components/History/HistoryView.tsx`
- `src/components/Sidebar/Sidebar.tsx` (extract the sidebar shell from `App.tsx` for a focused, testable unit) — optional but recommended; `App.tsx` is otherwise growing a large render block.

---

## Testing

- Unit: `listEventsForHistory` filtering (workspace scope, date range, person, excludes soft-deleted), grouping helper (Dziś/Wczoraj/date), `updateEvent` recalc + `updated_at` bump, `deleteEvent` soft-delete + recalc.
- Reuse existing sync test patterns to confirm `updateEvent`/`deleteEvent` enqueue an `event` upsert.
- Manual: edit an entry → `edytowano (...)` marker appears, minutes update everywhere; delete → entry gone, `cached_minutes` and reports drop the minutes; sidebar nav + Ctrl+1..4 work.

---

## Open questions

None — design approved.
