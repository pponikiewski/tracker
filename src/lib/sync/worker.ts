import { getDb } from "@/lib/db/connection";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth";
import { listReady, deleteByIds, bumpRetry, countPendingForUser } from "./outbox";
import { pathToLtree } from "@/lib/utils/ltree";
import type { Entity } from "./types";

interface ReadyRow {
  id: number;
  entity: Entity;
  entity_id: string;
  op: "upsert" | "delete";
  payload: string;
  attempts: number;
}

interface CollapseResult {
  perEntity: Record<Entity, ReadyRow[]>;
  supersededIds: Record<Entity, number[]>;
}

let timer: ReturnType<typeof setInterval> | null = null;
let pullTimer: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: (() => void) | null = null;
// Mutex so concurrent tick() invocations don't race each other against the
// single SQLite connection (which would yield "database is locked").
let tickInFlight: Promise<void> | null = null;
let pullInFlight: Promise<void> | null = null;

interface TickOptions {
  silent?: boolean;
}

export const FLUSH_ORDER: Entity[] = [
  "workspace",
  "workspace_membership",
  "resource",
  "event",
  "assignment",
  "activity_log",
];

export function collapseDuplicates(rows: ReadyRow[]): CollapseResult {
  const latest = new Map<string, ReadyRow>();
  const perEntity: Record<Entity, ReadyRow[]> = {
    resource: [],
    event: [],
    workspace: [],
    workspace_membership: [],
    assignment: [],
    activity_log: [],
  };
  const supersededIds: Record<Entity, number[]> = {
    resource: [],
    event: [],
    workspace: [],
    workspace_membership: [],
    assignment: [],
    activity_log: [],
  };

  for (const r of rows) {
    const k = `${r.entity}:${r.entity_id}`;
    const prev = latest.get(k);
    if (!prev) {
      latest.set(k, r);
      continue;
    }
    if (r.id > prev.id) {
      supersededIds[prev.entity].push(prev.id);
      latest.set(k, r);
    } else {
      supersededIds[r.entity].push(r.id);
    }
  }
  for (const r of latest.values()) perEntity[r.entity].push(r);
  return { perEntity, supersededIds };
}

// Exported for property tests (Property 8)
export function isValidTimestamp(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

// Exported for property tests (Property 7)
export function mapToCloud(data: Record<string, unknown>): Record<string, unknown> {
  const toIso = (v: number) => new Date(v).toISOString();
  return {
    ...data,
    created_at: toIso(data.created_at as number),
    updated_at: toIso(data.updated_at as number),
    deleted_at: data.deleted_at != null ? toIso(data.deleted_at as number) : null,
  };
}

/**
 * Maps a local Resource payload to cloud format.
 *
 * Supabase stores `resources.path` as ltree, whose labels may only contain
 * [A-Za-z0-9_] and must be separated by dots. Our local path format uses
 * hyphen-containing UUIDs separated by slashes, so we convert before push.
 */
export function mapResourceToCloud(
  data: Record<string, unknown>,
  userId: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    ...mapToCloud(data),
    user_id: userId,
  };
  const rawPath = data.path;
  const mapped: Record<string, unknown> = {
    id: base.id,
    workspace_id: base.workspace_id,
    parent_id: base.parent_id,
    name: base.name,
    type: base.type,
    color: base.color,
    path: base.path,
    cached_minutes: base.cached_minutes,
    user_id: base.user_id,
    created_at: base.created_at,
    updated_at: base.updated_at,
    deleted_at: base.deleted_at,
  };
  if (typeof rawPath === "string" && rawPath.length > 0) {
    mapped.path = pathToLtree(rawPath);
  }
  return mapped;
}

// Event author is stored in events.user_id. Preserve it when another workspace
// member edits or syncs the row.
export function mapEventToCloud(data: Record<string, unknown>): Record<string, unknown> {
  return mapToCloud(data);
}

// Exported for property tests (Property 10)
// Workspace has owner_id, NOT user_id — do not inject user_id
export function mapWorkspaceToCloud(data: Record<string, unknown>): Record<string, unknown> {
  const toIso = (v: number) => new Date(v).toISOString();
  return {
    ...data,
    created_at: toIso(data.created_at as number),
    updated_at: toIso(data.updated_at as number),
    deleted_at: data.deleted_at != null ? toIso(data.deleted_at as number) : null,
  };
}

// Exported for property tests (Property 10 — team-features)
// Assignment already carries user_id as a data field — do not inject it again.
// Converts created_at, updated_at, deleted_at from Unix epoch ms to ISO 8601 strings.
export function mapAssignmentToCloud(data: Record<string, unknown>): Record<string, unknown> {
  const toIso = (v: number) => new Date(v).toISOString();
  return {
    ...data,
    created_at: toIso(data.created_at as number),
    updated_at: toIso(data.updated_at as number),
    deleted_at: data.deleted_at != null ? toIso(data.deleted_at as number) : null,
  };
}

// Activity log rows carry their author in user_id; do not replace it with the
// currently authenticated sync user.
export function mapActivityLogToCloud(data: Record<string, unknown>): Record<string, unknown> {
  return mapToCloud(data);
}

function validateRowTimestamps(data: Record<string, unknown>): string | null {
  if (!isValidTimestamp(data.created_at)) return `invalid created_at: ${String(data.created_at)}`;
  if (!isValidTimestamp(data.updated_at)) return `invalid updated_at: ${String(data.updated_at)}`;
  if (data.deleted_at != null && !isValidTimestamp(data.deleted_at)) {
    return `invalid deleted_at: ${String(data.deleted_at)}`;
  }
  return null;
}

function validateMembershipTimestamps(data: Record<string, unknown>): string | null {
  if (!isValidTimestamp(data.joined_at)) return `invalid joined_at: ${String(data.joined_at)}`;
  if (data.display_role_updated_at != null && !isValidTimestamp(data.display_role_updated_at)) {
    return `invalid display_role_updated_at: ${String(data.display_role_updated_at)}`;
  }
  return null;
}

/**
 * Returns true for Supabase errors that will never succeed on retry —
 * specifically RLS violations and missing-table errors. These rows must be
 * dropped from the outbox to stop the sync error list from growing forever.
 */
function isPermanentRejection(error: { code?: string; message?: string }): boolean {
  const code = error.code;
  const msg = error.message?.toLowerCase() ?? "";
  // Missing table / relation
  if (code === "PGRST205" || code === "42P01") return true;
  if (msg.includes("could not find the table")) return true;
  if (msg.includes("relation") && msg.includes("does not exist")) return true;
  // RLS denial
  if (code === "42501") return true;
  if (msg.includes("row-level security") || msg.includes("row level security")) return true;
  if (msg.includes("violates row-level security policy")) return true;
  return false;
}

interface FlushOutcome {
  deletableIds: number[];
  failedIds: number[];
  invalidIds: number[];
  errorMessage?: string;
}

async function flushEntity(
  entity: Entity,
  latestRows: ReadyRow[],
  supersededIds: number[],
  userId: string,
): Promise<FlushOutcome> {
  const outcome: FlushOutcome = { deletableIds: [], failedIds: [], invalidIds: [] };
  if (latestRows.length === 0) {
    outcome.deletableIds.push(...supersededIds);
    return outcome;
  }
  if (!supabase) return outcome;

  const db = await getDb();

  // Handle workspace_membership separately (composite key delete, joined_at conversion)
  if (entity === "workspace_membership") {
    for (const row of latestRows) {
      const data = JSON.parse(row.payload) as Record<string, unknown>;

      if (row.op === "delete") {
        const { error } = await supabase
          .from("workspace_memberships")
          .delete()
          .match({ workspace_id: data.workspace_id, user_id: data.user_id });
        if (error) {
          if (isPermanentRejection(error)) {
            console.warn(
              `[sync] dropping membership delete for ${data.workspace_id}:${data.user_id} — permanently rejected (${error.message})`,
            );
            outcome.deletableIds.push(row.id);
          } else {
            await bumpRetry(db, [row.id], error.message, Date.now());
            outcome.failedIds.push(row.id);
            outcome.errorMessage = error.message;
          }
        } else {
          outcome.deletableIds.push(row.id);
        }
      } else {
        // upsert — validate joined_at
        const err = validateMembershipTimestamps(data);
        if (err) {
          await bumpRetry(db, [row.id], err, Date.now());
          outcome.invalidIds.push(row.id);
          continue;
        }
        const mapped = {
          ...data,
          joined_at: new Date(data.joined_at as number).toISOString(),
          display_role_updated_at:
            data.display_role_updated_at != null
              ? new Date(data.display_role_updated_at as number).toISOString()
              : null,
        };
        const { error } = await supabase
          .from("workspace_memberships")
          .upsert(mapped, { onConflict: "workspace_id,user_id" });
        if (error) {
          if (isPermanentRejection(error)) {
            console.warn(
              `[sync] dropping membership upsert for ${data.workspace_id}:${data.user_id} — permanently rejected (${error.message})`,
            );
            outcome.deletableIds.push(row.id);
          } else {
            await bumpRetry(db, [row.id], error.message, Date.now());
            outcome.failedIds.push(row.id);
            outcome.errorMessage = error.message;
          }
        } else {
          outcome.deletableIds.push(row.id);
        }
      }
    }
    // Superseded can be deleted regardless of individual row outcomes
    outcome.deletableIds.push(...supersededIds);
    return outcome;
  }

  // Handle workspace, resource, event (upsert-only entities)
  const toPush: Array<{ row: ReadyRow; mapped: Record<string, unknown> }> = [];

  for (const row of latestRows) {
    const data = JSON.parse(row.payload) as Record<string, unknown>;
    const err = validateRowTimestamps(data);
    if (err) {
      // Req 7.5: skip invalid row, record error
      await bumpRetry(db, [row.id], err, Date.now());
      outcome.invalidIds.push(row.id);
      continue;
    }
    const mapped =
      entity === "workspace"
        ? mapWorkspaceToCloud(data)
        : entity === "assignment"
          ? mapAssignmentToCloud(data)
          : entity === "resource"
            ? mapResourceToCloud(data, userId)
            : entity === "event"
              ? mapEventToCloud(data)
              : mapActivityLogToCloud(data);
    toPush.push({ row, mapped });
  }

  if (toPush.length === 0) {
    outcome.deletableIds.push(...supersededIds);
    return outcome;
  }

  const table =
    entity === "resource"
      ? "resources"
      : entity === "event"
        ? "events"
        : entity === "assignment"
          ? "assignments"
          : entity === "activity_log"
            ? "activity_log"
            : "workspaces";

  const { error } = await supabase.from(table).upsert(
    toPush.map((x) => x.mapped),
    { onConflict: "id" },
  );

  if (error) {
    if (isPermanentRejection(error)) {
      console.warn(
        `[sync] dropping ${toPush.length} ${table} row(s) — permanently rejected (${error.message})`,
      );
      outcome.deletableIds = [...toPush.map((x) => x.row.id), ...supersededIds];
      return outcome;
    }
    // Req 6.7: failure — bump retry on latest ids only, do NOT delete superseded
    outcome.failedIds = toPush.map((x) => x.row.id);
    outcome.errorMessage = error.message;
    return outcome;
  }

  // Success — delete latest + superseded
  outcome.deletableIds = [...toPush.map((x) => x.row.id), ...supersededIds];
  return outcome;
}

export async function tick(options: TickOptions = {}): Promise<void> {
  // Serialise concurrent invocations (interval timer + visibility handler
  // + explicit UI triggers can all fire in parallel).
  if (tickInFlight) return tickInFlight;
  tickInFlight = (async () => {
    try {
      await tickInternal(options);
    } finally {
      tickInFlight = null;
    }
  })();
  return tickInFlight;
}

async function tickInternal(options: TickOptions): Promise<void> {
  const silent = options.silent ?? false;
  const auth = useAuthStore.getState();
  if (auth.state.kind !== "authed") return;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    if (!silent) auth.setSyncStatus({ kind: "offline" });
    return;
  }
  const db = await getDb();
  const now = Date.now();
  const userId = auth.state.user.id;
  const rows = (await listReady(db, now, 50, userId)) as ReadyRow[];
  if (rows.length === 0) {
    auth.setPendingCount(await countPendingForUser(db, userId));
    return;
  }
  if (!silent) auth.setSyncStatus({ kind: "syncing" });
  const { perEntity, supersededIds } = collapseDuplicates(rows);

  // Req 6.7: flush each entity independently, with parent/workspace rows first
  // to avoid transient FK/RLS failures for newly created workspace data.
  const outcomes: Record<Entity, FlushOutcome> = {
    resource: { deletableIds: [], failedIds: [], invalidIds: [] },
    event: { deletableIds: [], failedIds: [], invalidIds: [] },
    workspace: { deletableIds: [], failedIds: [], invalidIds: [] },
    workspace_membership: { deletableIds: [], failedIds: [], invalidIds: [] },
    assignment: { deletableIds: [], failedIds: [], invalidIds: [] },
    activity_log: { deletableIds: [], failedIds: [], invalidIds: [] },
  };

  for (const entity of FLUSH_ORDER) {
    outcomes[entity] = await flushEntity(entity, perEntity[entity], supersededIds[entity], userId);
  }

  // Delete successfully flushed rows
  await deleteByIds(
    db,
    FLUSH_ORDER.flatMap((entity) => outcomes[entity].deletableIds),
  );

  // Bump retry only on failed latest rows (invalid rows already had bumpRetry called per-row)
  for (const entity of FLUSH_ORDER) {
    const outcome = outcomes[entity];
    if (outcome.failedIds.length > 0) {
      await bumpRetry(db, outcome.failedIds, outcome.errorMessage ?? "unknown", Date.now());
    }
  }

  const anyFailed = FLUSH_ORDER.some((entity) => {
    const outcome = outcomes[entity];
    return outcome.failedIds.length > 0 || outcome.invalidIds.length > 0;
  });

  if (anyFailed) {
    const msg =
      FLUSH_ORDER.map((entity) => outcomes[entity].errorMessage)
        .filter(Boolean)
        .join("; ") || "sync error";
    auth.setSyncStatus({ kind: "error", message: msg });
  } else {
    if (!silent || auth.syncStatus.kind !== "idle") {
      auth.setSyncStatus({ kind: "idle" });
    }
    auth.setLastSyncAt(Date.now());
  }
  auth.setPendingCount(await countPendingForUser(db, userId));
}

/**
 * Pull cloud changes for the currently authenticated user. Serialised so
 * concurrent calls don't stomp on each other.
 */
export async function pullNow(): Promise<void> {
  const auth = useAuthStore.getState();
  if (auth.state.kind !== "authed") return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const userId = auth.state.user.id;
  if (pullInFlight) return pullInFlight;
  pullInFlight = (async () => {
    try {
      // Lazy import avoids the worker → pull → worker import cycle.
      const { runIncrementalPull } = await import("./pull");
      await runIncrementalPull(userId);
    } finally {
      pullInFlight = null;
    }
  })();
  return pullInFlight;
}

export function startWorker(): void {
  if (timer) return; // Req 15.3: idempotent
  timer = setInterval(() => {
    void tick({ silent: true });
  }, 10_000);
  // Faza 7: Supabase Realtime delivers cloud changes near-instantly. This poll
  // stays only as a fallback for dropped websockets, hence the slow interval.
  pullTimer = setInterval(() => {
    void pullNow();
  }, 120_000);
  // Lazy import avoids the worker <-> realtime import cycle.
  void import("./realtime").then(({ startRealtime }) => startRealtime());
  if (typeof document !== "undefined") {
    visibilityHandler = () => {
      if (document.visibilityState === "visible") {
        void tick({ silent: true });
        void pullNow();
      }
    };
    document.addEventListener("visibilitychange", visibilityHandler);
  }
}

export function stopWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (pullTimer) {
    clearInterval(pullTimer);
    pullTimer = null;
  }
  void import("./realtime").then(({ stopRealtime }) => stopRealtime());
  if (visibilityHandler && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
}
