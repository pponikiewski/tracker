# UI Redesign + History View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the top nav bar with a fixed left sidebar, trim per-view header clutter, and add a new History view that lists every time-log entry with edit and delete.

**Architecture:** The app shell becomes a horizontal flex (fixed sidebar + flex-1 content). A new `HistoryView` reads events through a new workspace-scoped query, groups them by day with pure helpers, and edits/deletes them through new `queries.ts` functions wired into the projects Zustand store. `LogWorkModal` gains an optional edit mode reused by both the tree and the history view.

**Tech Stack:** React 19, TypeScript (strict + noUncheckedIndexedAccess), Zustand 5, Tailwind v4, Vitest, `lucide-react` (new), Tauri SQL plugin.

---

## File Structure

**New files:**
- `src/lib/utils/history.ts` — pure helpers: group events by day, day labels, timestamp formatting. Testable in isolation.
- `src/lib/utils/__tests__/history.test.ts` — unit tests for the above.
- `src/components/History/HistoryView.tsx` — the History feed view.
- `src/components/Sidebar/Sidebar.tsx` — the left sidebar shell extracted from `App.tsx`.

**Modified files:**
- `src/lib/db/queries.ts` — add `listEventsForHistory`, `updateEvent`, `deleteEvent`.
- `src/store/projects.ts` — add `updateLog` / `deleteLog` actions.
- `src/components/LogWorkModal.tsx` — optional edit mode; `resource` prop replaced by `resourceName`.
- `src/components/ProjectsView.tsx` — pass `resourceName` to `LogWorkModal`; remove kbd-hint row + `Faza 6` footer.
- `src/components/Dashboard/DashboardView.tsx` — add a `Raporty` title row to the header.
- `src/components/Team/TeamView.tsx` — add a `Zespół` title row to the header.
- `src/App.tsx` — render `Sidebar` instead of top `<nav>`; add `history` tab + lazy `HistoryView`; update keyboard shortcuts.
- `package.json` — add `lucide-react`.
- `CLAUDE.md` — document the new view and folders.

---

## Task 1: Add lucide-react dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

Run: `pnpm add lucide-react`
Expected: `package.json` gains `lucide-react` under `dependencies`; `pnpm-lock.yaml` updates.

- [ ] **Step 2: Verify it resolves**

Run: `pnpm typecheck`
Expected: PASS (no errors — nothing imports it yet).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(ui): add lucide-react for sidebar icons"
```

---

## Task 2: History pure helpers (TDD)

These are pure functions — fully unit-testable without a database. `EventWithResource` is already exported from `src/lib/db/queries.ts` (`TimeEvent` + `resource_name` + `resource_path`).

**Files:**
- Create: `src/lib/utils/history.ts`
- Test: `src/lib/utils/__tests__/history.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/utils/__tests__/history.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { EventWithResource } from "@/lib/db/queries";
import {
  groupEventsByDate,
  dayGroupLabel,
  isoMinusDays,
  formatTimestamp,
} from "@/lib/utils/history";

function ev(partial: Partial<EventWithResource>): EventWithResource {
  return {
    id: "e1",
    workspace_id: "w1",
    resource_id: "r1",
    date: "2026-05-14",
    minutes: 30,
    goal: null,
    topics: null,
    notes: null,
    report: null,
    user_id: "u1",
    created_at: 1_000,
    updated_at: 1_000,
    deleted_at: null,
    resource_name: "Task",
    resource_path: "p1/r1",
    ...partial,
  };
}

describe("isoMinusDays", () => {
  it("subtracts days across a month boundary", () => {
    expect(isoMinusDays("2026-05-01", 1)).toBe("2026-04-30");
  });
  it("returns same date for 0", () => {
    expect(isoMinusDays("2026-05-14", 0)).toBe("2026-05-14");
  });
});

describe("dayGroupLabel", () => {
  it("labels today", () => {
    expect(dayGroupLabel("2026-05-14", "2026-05-14")).toBe("Dziś");
  });
  it("labels yesterday", () => {
    expect(dayGroupLabel("2026-05-13", "2026-05-14")).toBe("Wczoraj");
  });
  it("formats older dates as DD.MM.YYYY", () => {
    expect(dayGroupLabel("2026-05-10", "2026-05-14")).toBe("10.05.2026");
  });
});

describe("groupEventsByDate", () => {
  it("buckets events per day, newest day first, summing minutes", () => {
    const events = [
      ev({ id: "a", date: "2026-05-14", minutes: 30 }),
      ev({ id: "b", date: "2026-05-14", minutes: 60 }),
      ev({ id: "c", date: "2026-05-12", minutes: 15 }),
    ];
    const groups = groupEventsByDate(events, "2026-05-14");
    expect(groups.map((g) => g.date)).toEqual(["2026-05-14", "2026-05-12"]);
    expect(groups[0]!.label).toBe("Dziś");
    expect(groups[0]!.events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(groups[0]!.totalMinutes).toBe(90);
    expect(groups[1]!.totalMinutes).toBe(15);
  });
  it("returns an empty array for no events", () => {
    expect(groupEventsByDate([], "2026-05-14")).toEqual([]);
  });
});

describe("formatTimestamp", () => {
  it("formats an epoch-ms value as DD.MM.YYYY HH:MM", () => {
    // 2026-05-14 16:42 local time
    const ms = new Date(2026, 4, 14, 16, 42).getTime();
    expect(formatTimestamp(ms)).toBe("14.05.2026 16:42");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/lib/utils/__tests__/history.test.ts`
Expected: FAIL — `Cannot find module '@/lib/utils/history'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/utils/history.ts`:

```typescript
import type { EventWithResource } from "@/lib/db/queries";

export interface DayGroup {
  /** ISO YYYY-MM-DD this group represents. */
  date: string;
  /** Human label: "Dziś" | "Wczoraj" | "DD.MM.YYYY". */
  label: string;
  /** Events for this day, in the order they were passed in. */
  events: EventWithResource[];
  /** Sum of `minutes` across the group's events. */
  totalMinutes: number;
}

/** Subtract `days` from an ISO YYYY-MM-DD string, returning ISO YYYY-MM-DD. */
export function isoMinusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y as number, (m as number) - 1, d as number);
  dt.setDate(dt.getDate() - days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** "Dziś" / "Wczoraj" / "DD.MM.YYYY" for `dateIso` relative to `todayIso`. */
export function dayGroupLabel(dateIso: string, todayIso: string): string {
  if (dateIso === todayIso) return "Dziś";
  if (dateIso === isoMinusDays(todayIso, 1)) return "Wczoraj";
  const [y, m, d] = dateIso.split("-");
  return `${d}.${m}.${y}`;
}

/**
 * Group events into per-day buckets, newest day first. Input events are
 * expected to already be sorted (date DESC, created_at DESC); ordering within
 * a day is preserved.
 */
export function groupEventsByDate(
  events: EventWithResource[],
  todayIso: string,
): DayGroup[] {
  const byDate = new Map<string, EventWithResource[]>();
  for (const e of events) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }
  const dates = [...byDate.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return dates.map((date) => {
    const evs = byDate.get(date) ?? [];
    return {
      date,
      label: dayGroupLabel(date, todayIso),
      events: evs,
      totalMinutes: evs.reduce((sum, e) => sum + e.minutes, 0),
    };
  });
}

/** Format an epoch-ms timestamp as "DD.MM.YYYY HH:MM" (local time). */
export function formatTimestamp(ms: number): string {
  const dt = new Date(ms);
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yy = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, "0");
  const mi = String(dt.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yy} ${hh}:${mi}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/lib/utils/__tests__/history.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/history.ts src/lib/utils/__tests__/history.test.ts
git commit -m "feat(history): add pure helpers for grouping log entries by day"
```

---

## Task 3: DB queries — listEventsForHistory, updateEvent, deleteEvent

These functions hit the Tauri SQL plugin and follow the existing untested pattern in `queries.ts` (e.g. `createEvent` has no unit test — the DB layer is verified manually and through sync tests). `withTx`, `now`, `getDb`, `enqueue`, and `recalcCachedMinutesForResource` already exist in this file.

**Files:**
- Modify: `src/lib/db/queries.ts` (append to the `// ---- Events ----` section, after `listEventsInRange` / before `recalcCachedMinutesForResource`)

- [ ] **Step 1: Add `listEventsForHistory`**

In `src/lib/db/queries.ts`, immediately after the `listEventsInRange` function (ends at the line `  );` closing its `db.select` return), add:

```typescript
/**
 * List events for the History view: workspace-scoped, within a date range,
 * optionally filtered to a single author. Ordered newest-log-date first, and
 * within a day most-recently-entered first. Excludes soft-deleted rows.
 */
export async function listEventsForHistory(
  workspaceId: string,
  fromIso: string,
  toIso: string,
  userId?: string | null,
): Promise<EventWithResource[]> {
  const db = await getDb();
  const base = `SELECT e.*, r.name AS resource_name, r.path AS resource_path
     FROM events e
     JOIN resources r ON r.id = e.resource_id
     WHERE e.deleted_at IS NULL
       AND r.deleted_at IS NULL
       AND e.workspace_id = $1
       AND e.date >= $2 AND e.date <= $3`;
  if (userId) {
    return db.select<EventWithResource[]>(
      `${base} AND e.user_id = $4 ORDER BY e.date DESC, e.created_at DESC`,
      [workspaceId, fromIso, toIso, userId],
    );
  }
  return db.select<EventWithResource[]>(
    `${base} ORDER BY e.date DESC, e.created_at DESC`,
    [workspaceId, fromIso, toIso],
  );
}
```

- [ ] **Step 2: Add `updateEvent`**

Immediately below `listEventsForHistory`, add:

```typescript
export interface UpdateEventInput {
  id: string;
  date: string;
  minutes: number;
  goal?: string;
  topics?: string;
  notes?: string;
  report?: string;
}

/**
 * Update an existing event. Bumps `updated_at` (which drives the "edytowano"
 * marker in the UI). Recalculates the resource's cached_minutes when `minutes`
 * or `date` changed, and enqueues the row for sync.
 */
export async function updateEvent(input: UpdateEventInput): Promise<void> {
  return withTx(async (db) => {
    const ts = now();
    const existing = await db.select<TimeEvent[]>(
      "SELECT * FROM events WHERE id = $1",
      [input.id],
    );
    const prev = existing[0];
    if (!prev) return;
    await db.execute(
      `UPDATE events
         SET date = $1, minutes = $2, goal = $3, topics = $4,
             notes = $5, report = $6, updated_at = $7
       WHERE id = $8`,
      [
        input.date,
        input.minutes,
        input.goal ?? null,
        input.topics ?? null,
        input.notes ?? null,
        input.report ?? null,
        ts,
        input.id,
      ],
    );
    if (prev.minutes !== input.minutes || prev.date !== input.date) {
      await recalcCachedMinutesForResource(prev.resource_id);
    }
    const rows = await db.select<TimeEvent[]>(
      "SELECT * FROM events WHERE id = $1",
      [input.id],
    );
    if (rows[0]) {
      await enqueue(db, "event", input.id, "upsert", rows[0] as unknown as Record<string, unknown>);
    }
  });
}
```

- [ ] **Step 3: Add `deleteEvent`**

Immediately below `updateEvent`, add:

```typescript
/**
 * Soft-delete an event: sets `deleted_at`, recalculates the resource's
 * cached_minutes so the removed time drops out of all rollups/reports, and
 * enqueues the row for sync (the sync layer treats a soft-deleted row as an
 * upsert with deleted_at set, same as resources).
 */
export async function deleteEvent(id: string): Promise<void> {
  return withTx(async (db) => {
    const ts = now();
    const existing = await db.select<TimeEvent[]>(
      "SELECT * FROM events WHERE id = $1",
      [id],
    );
    const prev = existing[0];
    if (!prev) return;
    await db.execute(
      "UPDATE events SET deleted_at = $1, updated_at = $1 WHERE id = $2",
      [ts, id],
    );
    await recalcCachedMinutesForResource(prev.resource_id);
    const rows = await db.select<TimeEvent[]>(
      "SELECT * FROM events WHERE id = $1",
      [id],
    );
    if (rows[0]) {
      await enqueue(db, "event", id, "upsert", rows[0] as unknown as Record<string, unknown>);
    }
  });
}
```

- [ ] **Step 4: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/queries.ts
git commit -m "feat(history): add listEventsForHistory, updateEvent, deleteEvent queries"
```

---

## Task 4: Projects store — updateLog / deleteLog actions

**Files:**
- Modify: `src/store/projects.ts`

- [ ] **Step 1: Extend the imports**

In `src/store/projects.ts`, change the `@/lib/db/queries` import block to also import the two new functions and the input type:

```typescript
import {
  createEvent,
  createResource,
  deleteEvent,
  detachChildrenAsProjects,
  liftChildrenAndDelete,
  listActiveResources,
  moveResource,
  renameResource,
  setResourceColor,
  softDeleteSubtree,
  updateEvent,
  type CreateEventInput,
  type UpdateEventInput,
} from "@/lib/db/queries";
```

- [ ] **Step 2: Extend the `ProjectsState` interface**

In the `ProjectsState` interface, immediately after the `logTime` line, add:

```typescript
  updateLog: (input: UpdateEventInput) => Promise<void>;
  deleteLog: (id: string) => Promise<void>;
```

- [ ] **Step 3: Implement the actions**

In the `create<ProjectsState>(...)` object, immediately after the `logTime` action, add:

```typescript
  updateLog: async (input) => {
    await updateEvent(input);
    await get().refresh();
  },

  deleteLog: async (id) => {
    await deleteEvent(id);
    await get().refresh();
  },
```

- [ ] **Step 4: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/projects.ts
git commit -m "feat(history): expose updateLog/deleteLog from projects store"
```

---

## Task 5: LogWorkModal — optional edit mode

`LogWorkModal` currently only uses `resource.name` from its `resource` prop. Replace that prop with a plain `resourceName: string` and add an optional `event?: TimeEvent` prop that, when present, initializes the form from the event and switches the heading to "Edytuj wpis".

**Files:**
- Modify: `src/components/LogWorkModal.tsx`
- Modify: `src/components/ProjectsView.tsx` (the one `<LogWorkModal>` call site)

- [ ] **Step 1: Update `LogWorkModal` props and state**

In `src/components/LogWorkModal.tsx`, change the import line and `Props` interface:

```typescript
import { useEffect, useState } from "react";
import type { TimeEvent } from "@/lib/db/types";
import { parseTime, todayIso } from "@/lib/utils/time";

interface Props {
  resourceName: string;
  /** When provided, the modal edits this event instead of creating a new one. */
  event?: TimeEvent;
  onSubmit: (input: {
    date: string;
    minutes: number;
    goal?: string;
    topics?: string;
    notes?: string;
    report?: string;
  }) => void | Promise<void>;
  onCancel: () => void;
}
```

Then change the function signature and the six `useState` initializers:

```typescript
export function LogWorkModal({ resourceName, event, onSubmit, onCancel }: Props) {
  const [date, setDate] = useState(event?.date ?? todayIso());
  const [timeInput, setTimeInput] = useState(event ? String(event.minutes) : "");
  const [goal, setGoal] = useState(event?.goal ?? "");
  const [topics, setTopics] = useState(event?.topics ?? "");
  const [notes, setNotes] = useState(event?.notes ?? "");
  const [report, setReport] = useState(event?.report ?? "");
  const [submitting, setSubmitting] = useState(false);
```

- [ ] **Step 2: Update the heading and the resource label**

In the same file, change the heading `<h2>` and the resource-name `<p>`:

```tsx
        <h2 className="mb-1 text-sm font-semibold text-neutral-200">
          {event ? "Edytuj wpis" : "Loguj czas"}
        </h2>
        <p className="mb-3 truncate text-xs text-neutral-500">{resourceName}</p>
```

- [ ] **Step 3: Update the ProjectsView call site**

In `src/components/ProjectsView.tsx`, find the `<LogWorkModal ... />` block (near the end of the component) and change the `resource` prop to `resourceName`:

```tsx
      {logWorkResource && (
        <LogWorkModal
          resourceName={logWorkResource.name}
          onSubmit={async (input) => {
            await logTime({ resourceId: logWorkResource.id, ...input });
            setLogWorkResource(null);
          }}
          onCancel={() => setLogWorkResource(null)}
        />
      )}
```

- [ ] **Step 4: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/LogWorkModal.tsx src/components/ProjectsView.tsx
git commit -m "feat(history): add edit mode to LogWorkModal"
```

---

## Task 6: HistoryView component

A workspace-scoped feed of every log entry, grouped by day, with person + date-range filters and edit/delete per entry.

**Files:**
- Create: `src/components/History/HistoryView.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/History/HistoryView.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "@/store/workspace";
import { useProfileStore } from "@/store/profile";
import { useProjects } from "@/store/projects";
import {
  listEventsForHistory,
  type EventWithResource,
} from "@/lib/db/queries";
import type { TimeEvent } from "@/lib/db/types";
import { daysAgoIso } from "@/lib/analytics/aggregate";
import { todayIso, formatMinutes } from "@/lib/utils/time";
import { groupEventsByDate, formatTimestamp } from "@/lib/utils/history";
import { AvatarBadge } from "@/components/Profile/AvatarBadge";
import { LogWorkModal } from "@/components/LogWorkModal";

/** Person filter: 'all' or a specific user_id. */
type PersonFilter = "all" | string;

export function HistoryView() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const memberships = useWorkspaceStore((s) => s.memberships);
  const getProfile = useProfileStore((s) => s.getProfile);
  const { updateLog, deleteLog } = useProjects();

  const [fromIso, setFromIso] = useState(() => daysAgoIso(29));
  const [toIso, setToIso] = useState(() => todayIso());
  const [personFilter, setPersonFilter] = useState<PersonFilter>("all");

  const [events, setEvents] = useState<EventWithResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<EventWithResource | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  // Bumped after an edit/delete to force the load effect to re-run.
  const [reloadKey, setReloadKey] = useState(0);

  // Reset the person filter when the workspace changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- filter is scoped to the active workspace
    setPersonFilter("all");
  }, [activeWorkspaceId]);

  // Load events whenever workspace, range, person filter, or reloadKey changes.
  useEffect(() => {
    if (activeWorkspaceId === null) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    listEventsForHistory(
      activeWorkspaceId,
      fromIso,
      toIso,
      personFilter === "all" ? null : personFilter,
    )
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, fromIso, toIso, personFilter, reloadKey]);

  const members = useMemo(
    () =>
      memberships
        .filter((m) => m.workspace_id === activeWorkspaceId)
        .map((m) => ({ userId: m.user_id, name: getProfile(m.user_id).display_name })),
    [memberships, activeWorkspaceId, getProfile],
  );

  const groups = useMemo(() => groupEventsByDate(events, todayIso()), [events]);
  const totalMinutes = useMemo(
    () => events.reduce((sum, e) => sum + e.minutes, 0),
    [events],
  );

  // Force the load effect to re-run (after an edit or delete).
  const reload = () => setReloadKey((k) => k + 1);

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <header className="shrink-0 border-b border-neutral-800/80 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-neutral-100">
              Historia
            </h1>
            <p className="mt-1 text-xs text-neutral-500">
              {loading ? "Ładowanie..." : `${events.length} wpisów`} ·{" "}
              {formatMinutes(totalMinutes)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={personFilter}
              onChange={(e) => setPersonFilter(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 focus:border-blue-500 focus:outline-none"
              aria-label="Filtr osoby"
            >
              <option value="all">Wszyscy</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={fromIso}
              onChange={(e) => setFromIso(e.target.value)}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-blue-500"
            />
            <span className="text-neutral-600">→</span>
            <input
              type="date"
              value={toIso}
              onChange={(e) => setToIso(e.target.value)}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </header>

      {error && (
        <div className="border-b border-red-900 bg-red-950 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <main className="flex-1 overflow-auto px-5 py-4">
        {groups.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md rounded-lg border border-neutral-800 bg-neutral-900/60 px-6 py-8 text-center text-sm text-neutral-500">
            <h2 className="text-sm font-semibold text-neutral-200">Brak wpisów</h2>
            <p className="mt-2">Brak logów czasu w wybranym zakresie.</p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.date} className="mb-6">
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                  {group.label}
                </h2>
                <span className="text-[10px] text-neutral-600">
                  {formatMinutes(group.totalMinutes)}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {group.events.map((e) => {
                  const profile = getProfile(e.user_id ?? "");
                  const edited = e.updated_at > e.created_at;
                  return (
                    <article
                      key={e.id}
                      className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          {e.user_id ? (
                            <AvatarBadge
                              userId={e.user_id}
                              displayName={profile.display_name}
                              avatarUrl={profile.avatar_url}
                              size="xs"
                            />
                          ) : (
                            <span className="text-neutral-600">—</span>
                          )}
                          <span className="text-sm font-medium text-neutral-100">
                            {e.user_id ? profile.display_name : "Nieznany"}
                          </span>
                          <span className="truncate text-xs text-neutral-500">
                            → {e.resource_name}
                          </span>
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-blue-400">
                          {formatMinutes(e.minutes)}
                        </span>
                      </div>

                      <div className="mt-1.5 space-y-0.5 text-xs text-neutral-400">
                        {e.goal && (
                          <p>
                            <span className="text-neutral-500">Cel:</span> {e.goal}
                          </p>
                        )}
                        {e.topics && (
                          <p>
                            <span className="text-neutral-500">Tematy:</span> {e.topics}
                          </p>
                        )}
                        {e.notes && (
                          <p>
                            <span className="text-neutral-500">Notatki:</span> {e.notes}
                          </p>
                        )}
                        {e.report && (
                          <p>
                            <span className="text-neutral-500">Raport:</span> {e.report}
                          </p>
                        )}
                      </div>

                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[10px] text-neutral-600">
                          log na {e.date} · wpisano {formatTimestamp(e.created_at)}
                          {edited && ` · edytowano (${formatTimestamp(e.updated_at)})`}
                        </span>
                        <div className="flex items-center gap-1">
                          {confirmingDeleteId === e.id ? (
                            <>
                              <button
                                type="button"
                                onClick={async () => {
                                  await deleteLog(e.id);
                                  setConfirmingDeleteId(null);
                                  reload();
                                }}
                                className="rounded px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-950"
                              >
                                Usuń na pewno
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmingDeleteId(null)}
                                className="rounded px-2 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-800"
                              >
                                Anuluj
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => setEditing(e)}
                                className="rounded px-2 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                              >
                                Edytuj
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmingDeleteId(e.id)}
                                className="rounded px-2 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-800 hover:text-red-300"
                              >
                                Usuń
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </main>

      {editing && (
        <LogWorkModal
          resourceName={editing.resource_name}
          event={editing as TimeEvent}
          onSubmit={async (input) => {
            await updateLog({ id: editing.id, ...input });
            setEditing(null);
            reload();
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Verify lint is clean**

Run: `pnpm lint`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/components/History/HistoryView.tsx
git commit -m "feat(history): add HistoryView feed with edit and delete"
```

---

## Task 7: Sidebar component

Extract the app shell's navigation into a focused `Sidebar` component. It renders the logo, `WorkspaceSwitcher`, the nav list (with `lucide-react` icons), and the `SyncStatusBadge` + `AuthGate` footer.

**Files:**
- Create: `src/components/Sidebar/Sidebar.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/Sidebar/Sidebar.tsx`:

```tsx
import { FolderTree, BarChart3, History, Users } from "lucide-react";
import { WorkspaceSwitcher } from "@/components/Workspace/WorkspaceSwitcher";
import { SyncStatusBadge } from "@/components/Auth/SyncStatusBadge";
import { AuthGate } from "@/components/Auth/AuthGate";

export type Tab = "projects" | "dashboard" | "history" | "team";

interface SidebarProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  showTeamTab: boolean;
}

interface NavDef {
  id: Tab;
  label: string;
  icon: typeof FolderTree;
  hint: string;
}

const NAV: NavDef[] = [
  { id: "projects", label: "Projekty", icon: FolderTree, hint: "Ctrl+1" },
  { id: "dashboard", label: "Raporty", icon: BarChart3, hint: "Ctrl+2" },
  { id: "history", label: "Historia", icon: History, hint: "Ctrl+3" },
  { id: "team", label: "Zespół", icon: Users, hint: "Ctrl+4" },
];

export function Sidebar({ tab, onTabChange, showTeamTab }: SidebarProps) {
  const items = NAV.filter((n) => n.id !== "team" || showTeamTab);

  return (
    <aside className="flex w-48 shrink-0 flex-col border-r border-neutral-800/80 bg-neutral-950 px-3 py-4">
      <div className="flex items-center gap-2 px-1">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-600 text-[11px] font-bold text-white shadow-sm">
          T
        </span>
        <span className="text-sm font-semibold tracking-tight text-neutral-100">
          tracker
        </span>
      </div>

      <div className="mt-4">
        <WorkspaceSwitcher />
      </div>

      <nav className="mt-4 flex flex-col gap-0.5">
        {items.map((n) => {
          const Icon = n.icon;
          const active = tab === n.id;
          return (
            <button
              key={n.id}
              type="button"
              title={n.hint}
              onClick={() => onTabChange(n.id)}
              className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                active
                  ? "bg-neutral-100 text-neutral-950"
                  : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
              }`}
            >
              <Icon size={15} strokeWidth={2} />
              {n.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-neutral-800/80 pt-3">
        <SyncStatusBadge />
        <AuthGate />
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar/Sidebar.tsx
git commit -m "feat(ui): add left Sidebar component"
```

---

## Task 8: App.tsx — sidebar shell + history tab + shortcuts

Replace the top `<nav>` with `<Sidebar>`, add the `history` tab and its lazy-loaded view, and update the keyboard shortcuts to `Ctrl+1..4`.

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update imports and the `Tab` type**

In `src/App.tsx`, replace the import block (lines 1–9) and the `Tab` type (line 19) with:

```tsx
import { lazy, Suspense, useEffect, useState } from "react";
import { AuthGate } from "@/components/Auth/AuthGate";
import { LoginPage } from "@/components/Auth/LoginPage";
import { ProjectsView } from "./components/ProjectsView";
import { WorkspaceEmptyState } from "@/components/Workspace/WorkspaceEmptyState";
import { Sidebar, type Tab } from "@/components/Sidebar/Sidebar";
import { useAuthStore } from "@/store/auth";
import { useWorkspaceStore } from "@/store/workspace";

const DashboardView = lazy(() =>
  import("./components/Dashboard/DashboardView").then((m) => ({ default: m.DashboardView })),
);

const TeamView = lazy(() =>
  import("./components/Team/TeamView").then((m) => ({ default: m.TeamView })),
);

const HistoryView = lazy(() =>
  import("./components/History/HistoryView").then((m) => ({ default: m.HistoryView })),
);
```

Note: `AuthGate`, `SyncStatusBadge`, and `WorkspaceSwitcher` are no longer rendered directly by `App.tsx` (the Sidebar renders them). `AuthGate` import above is removed in Step 5 if unused — but it IS still unused after this step, so delete the `AuthGate` import line now. The corrected block is:

```tsx
import { lazy, Suspense, useEffect, useState } from "react";
import { LoginPage } from "@/components/Auth/LoginPage";
import { ProjectsView } from "./components/ProjectsView";
import { WorkspaceEmptyState } from "@/components/Workspace/WorkspaceEmptyState";
import { Sidebar, type Tab } from "@/components/Sidebar/Sidebar";
import { useAuthStore } from "@/store/auth";
import { useWorkspaceStore } from "@/store/workspace";

const DashboardView = lazy(() =>
  import("./components/Dashboard/DashboardView").then((m) => ({ default: m.DashboardView })),
);

const TeamView = lazy(() =>
  import("./components/Team/TeamView").then((m) => ({ default: m.TeamView })),
);

const HistoryView = lazy(() =>
  import("./components/History/HistoryView").then((m) => ({ default: m.HistoryView })),
);
```

Delete the local `type Tab = ...` line entirely — `Tab` is now imported from the Sidebar.

- [ ] **Step 2: Update the keyboard-shortcuts effect**

Replace the global keyboard-shortcuts `useEffect` (the one mapping `e.key === "1"` etc.) with:

```tsx
  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "1") {
        e.preventDefault();
        setTab("projects");
      } else if (e.key === "2") {
        e.preventDefault();
        setTab("dashboard");
      } else if (e.key === "3") {
        e.preventDefault();
        setTab("history");
      } else if (e.key === "4" && showTeamTab) {
        e.preventDefault();
        setTab("team");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showTeamTab]);
```

- [ ] **Step 3: Replace the render shell**

Replace the entire returned JSX (from `return (` with the `<div className="flex h-full flex-col ...">` down to its closing `)` — i.e. the whole top-nav layout) with:

```tsx
  return (
    <div className="flex h-full bg-neutral-950 text-neutral-100">
      <Sidebar tab={tab} onTabChange={setTab} showTeamTab={showTeamTab} />
      <div className="flex-1 overflow-hidden bg-neutral-950">
        {tab === "projects" ? (
          <ProjectsView />
        ) : tab === "history" ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                Ładowanie historii…
              </div>
            }
          >
            <HistoryView />
          </Suspense>
        ) : tab === "team" ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                Ładowanie widoku zespołu…
              </div>
            }
          >
            <TeamView />
          </Suspense>
        ) : (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                Ładowanie dashboardu…
              </div>
            }
          >
            <DashboardView />
          </Suspense>
        )}
      </div>
    </div>
  );
```

- [ ] **Step 4: Delete the now-unused `TabButton` component**

Delete the entire `function TabButton({ ... }) { ... }` definition near the bottom of the file (it was only used by the old top nav).

- [ ] **Step 5: Verify typecheck and lint**

Run: `pnpm typecheck`
Expected: PASS — no unused-import or undefined-symbol errors.

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): replace top nav with left sidebar shell, add History tab"
```

---

## Task 9: ProjectsView — trim header clutter

Remove the keyboard-shortcuts hint row and the `Faza 6` footer. Keep the title, the stat subtitle, the `Nowy projekt` button, the error banner, the assignment filter bar, and the tree.

**Files:**
- Modify: `src/components/ProjectsView.tsx`

- [ ] **Step 1: Remove the keyboard-shortcuts hint row**

In `src/components/ProjectsView.tsx`, delete this block inside the `<header>` (it sits right after the `flex-wrap` title/button `div`):

```tsx
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-neutral-600">
          <span>Ctrl+N nowy</span>
          <span>F2 zmień nazwę</span>
          <span>L loguj czas</span>
          <span>Drag-drop przenosi elementy</span>
        </div>
```

- [ ] **Step 2: Remove the footer**

Delete this block (near the end of the returned JSX, after `</main>`):

```tsx
      <footer className="border-t border-neutral-800/80 px-5 py-2 text-[10px] text-neutral-600">
        Faza 6 · Team visibility
      </footer>
```

- [ ] **Step 3: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/ProjectsView.tsx
git commit -m "refactor(ui): trim ProjectsView header clutter"
```

---

## Task 10: Dashboard + Team — add title rows

Neither view currently shows a title. Add a small title row at the top of each header so all four views share the title + controls shape.

**Files:**
- Modify: `src/components/Dashboard/DashboardView.tsx`
- Modify: `src/components/Team/TeamView.tsx`

- [ ] **Step 1: Add a title to DashboardView**

In `src/components/Dashboard/DashboardView.tsx`, inside the `<header className="border-b border-neutral-800 px-4 py-3">`, add a title row as the first child (immediately before the `<div className="mb-3 flex items-center gap-2">` range row):

```tsx
        <h1 className="mb-3 text-lg font-semibold tracking-tight text-neutral-100">
          Raporty
        </h1>
```

- [ ] **Step 2: Add a title to TeamView**

In `src/components/Team/TeamView.tsx`, inside the `<header className="border-b border-neutral-800 px-4 py-3 shrink-0">`, add a title row as the first child (immediately before the `<div className="flex flex-wrap items-center gap-2">`):

```tsx
        <h1 className="mb-3 text-lg font-semibold tracking-tight text-neutral-100">
          Zespół
        </h1>
```

- [ ] **Step 3: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/Dashboard/DashboardView.tsx src/components/Team/TeamView.tsx
git commit -m "refactor(ui): add title rows to Dashboard and Team headers"
```

---

## Task 11: Full verification + docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the full validation suite**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS. `pnpm test` includes the new `history.test.ts`.

- [ ] **Step 2: Manual smoke test**

Run: `pnpm tauri dev` and verify:
- Left sidebar shows logo, workspace switcher, nav (Projekty / Raporty / Historia / Zespół with icons), sync badge + account at the bottom. No top bar.
- `Ctrl+1..4` switch tabs (Ctrl+4 only when the Team tab is visible).
- Historia: entries grouped by day; each card shows author, resource, minutes, only the filled fields, and the `log na … · wpisano …` footer.
- Edit an entry → `LogWorkModal` opens titled "Edytuj wpis" pre-filled; after save the card shows `· edytowano (…)` and the minutes update.
- Delete an entry → inline confirm → entry disappears; switch to Projekty and confirm the resource's minutes dropped; switch to Raporty and confirm the total dropped.
- Person and date-range filters in Historia re-query correctly.

- [ ] **Step 3: Update CLAUDE.md**

In `CLAUDE.md`, under the folder structure list, add the new entries:

```
- `src/components/History/` — `HistoryView`
- `src/components/Sidebar/` — `Sidebar`
- `src/lib/utils/history.ts` — groupEventsByDate, dayGroupLabel, formatTimestamp
```

And add a short note to the "Current phase" section describing the UI redesign (left sidebar replacing top nav) and the new History view with edit/delete of time logs.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document UI redesign and History view"
```

---

## Self-Review Notes

- **Spec coverage:** Sidebar layout C → Tasks 7–8. Header pattern B → Tasks 9–10 (+ HistoryView header in Task 6). Icons → Tasks 1, 7. History view → Tasks 2, 3, 6. Edit → Tasks 3, 4, 5, 6. Delete → Tasks 3, 4, 6. CLAUDE.md → Task 11. All spec sections mapped.
- **Type consistency:** `UpdateEventInput` defined in Task 3, consumed in Tasks 4 and 6. `Tab` defined in Task 7's Sidebar, imported in Task 8's App.tsx. `EventWithResource` is pre-existing and reused everywhere. `LogWorkModal` prop `resourceName` + `event` defined in Task 5, consumed in Task 6.
- **Testing reality:** Only Task 2 has unit tests — the `queries.ts` DB functions follow the existing untested pattern in that file (the Tauri SQL plugin is not available under Vitest); they are covered by the Task 11 manual smoke test instead.
- **HistoryView reload:** uses a `reloadKey` counter in the load effect's dependency array, bumped by `reload()` after edit/delete — guarantees the list re-queries.
```
