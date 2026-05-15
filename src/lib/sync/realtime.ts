import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/auth";

/**
 * Faza 7 — Realtime sync.
 *
 * Subscribes to a single per-user channel covering all synced tables. Any
 * insert/update/delete in the cloud (made by another team member) triggers a
 * debounced incremental pull, which runs the existing LWW merge and reloads the
 * UI. This replaces the slow 30s poll with near-instant updates; the worker
 * still keeps a long-interval poll as a fallback for dropped websockets.
 *
 * We deliberately do NOT apply row payloads directly here — re-running
 * `runIncrementalPull` reuses the proven merge + path-rebuild + cached_minutes
 * recalc pipeline and is idempotent, so a coalesced pull is both simpler and
 * safer than per-row apply logic.
 */

let channel: RealtimeChannel | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let firstScheduledAt = 0;
let onDisconnected: (() => void) | null = null;

const DEBOUNCE_MS = 400;
const MAX_WAIT_MS = 2000;

export function setDisconnectHandler(fn: () => void): void {
  onDisconnected = fn;
}

const SYNCED_TABLES = [
  "resources",
  "events",
  "workspaces",
  "workspace_memberships",
  "assignments",
  "profiles",
  "activity_log",
] as const;

// Coalesce bursts of changes into one pull, with maxWait so a continuous
// change stream doesn't starve the debounce indefinitely.
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
      // Lazy import avoids the worker <-> realtime import cycle.
      const { pullNow } = await import("./worker");
      await pullNow();
    })();
  }, wait);
}

/**
 * Opens the realtime channel. Idempotent — safe to call repeatedly.
 * No-op when Supabase is not configured or the user is not authenticated.
 */
export function startRealtime(): void {
  if (!supabase) return;
  if (channel) return;
  if (useAuthStore.getState().state.kind !== "authed") return;

  let ch = supabase.channel("tracker-sync");
  for (const table of SYNCED_TABLES) {
    ch = ch.on("postgres_changes", { event: "*", schema: "public", table }, schedulePull);
  }
  channel = ch.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      void import("./worker").then(({ onRealtimeReconnected }) => onRealtimeReconnected());
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      console.warn(`[realtime] ${status} — switching to fast-poll`);
      onDisconnected?.();
    }
  });
}

/** Closes the realtime channel and cancels any pending debounced pull. */
export function stopRealtime(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (channel && supabase) {
    void supabase.removeChannel(channel);
  }
  channel = null;
}
