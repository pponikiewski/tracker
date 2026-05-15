import { useCallback, useEffect, useMemo, useState } from "react";
import { AvatarBadge } from "@/components/Profile/AvatarBadge";
import { listRecentActivity } from "@/lib/activity/activityLog";
import type { ActivityLogEntry } from "@/lib/db/types";
import { formatTimestamp } from "@/lib/utils/history";
import { useProfileStore } from "@/store/profile";
import { useWorkspaceStore } from "@/store/workspace";

const ACTION_LABELS: Record<string, string> = {
  "resource.create": "Projekt",
  "resource.rename": "Zmiana",
  "resource.color": "Kolor",
  "resource.move": "Ruch",
  "resource.delete_subtree": "Usunięcie",
  "resource.lift_delete": "Usunięcie",
  "resource.detach_delete": "Usunięcie",
  "event.create": "Czas",
  "event.update": "Edycja",
  "event.delete": "Usunięcie",
  "workspace.create": "Workspace",
  "workspace.rename": "Workspace",
  "workspace.delete": "Workspace",
  "member.display_role": "Zespół",
  "member.remove": "Zespół",
  "member.join": "Zespół",
  "assignment.create": "Przypisanie",
  "assignment.restore": "Przypisanie",
  "assignment.delete": "Przypisanie",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? "Akcja";
}

export function ActivityLogPanel() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const getProfile = useProfileStore((s) => s.getProfile);
  const fetchProfiles = useProfileStore((s) => s.fetchProfiles);
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) {
      setEntries([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setEntries(await listRecentActivity(activeWorkspaceId, 30));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- activity feed is workspace-scoped external SQLite data
    void load();
  }, [load]);

  useEffect(() => {
    const onChange = () => {
      void load();
    };
    window.addEventListener("tracker:activity-log-changed", onChange);
    return () => window.removeEventListener("tracker:activity-log-changed", onChange);
  }, [load]);

  const userIds = useMemo(
    () => [
      ...new Set(entries.map((entry) => entry.user_id).filter((id): id is string => Boolean(id))),
    ],
    [entries],
  );

  useEffect(() => {
    if (userIds.length > 0) void fetchProfiles(userIds);
  }, [fetchProfiles, userIds]);

  return (
    <section className="mt-4 rounded-md border border-neutral-800 bg-neutral-900 p-3">
      <div className="mb-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Log zdarzeń
          </h2>
          <p className="mt-1 text-[11px] text-neutral-500">Ostatnie akcje w aktywnym workspace.</p>
        </div>
      </div>

      {error ? (
        <div className="rounded border border-red-900 bg-red-950 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      ) : loading && entries.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-sm text-neutral-500">
          Ładowanie...
        </div>
      ) : entries.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-sm text-neutral-500">
          Brak zdarzeń.
        </div>
      ) : (
        <div className="divide-y divide-neutral-800">
          {entries.map((entry) => {
            const profile = entry.user_id ? getProfile(entry.user_id) : null;
            return (
              <article key={entry.id} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                {profile && entry.user_id ? (
                  <AvatarBadge
                    userId={entry.user_id}
                    displayName={profile.display_name}
                    avatarUrl={profile.avatar_url}
                    size="xs"
                  />
                ) : (
                  <span className="h-5 w-5 shrink-0 rounded-full bg-neutral-800" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm text-neutral-200">
                      {profile?.display_name ?? "Nieznany"}
                    </span>
                    <span className="shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                      {actionLabel(entry.action)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-neutral-400" title={entry.summary}>
                    {entry.summary}
                  </p>
                </div>
                <time className="shrink-0 text-[11px] text-neutral-600">
                  {formatTimestamp(entry.created_at)}
                </time>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
