import { useEffect, useMemo, useState } from "react";
import { AvatarBadge } from "@/components/Profile/AvatarBadge";
import { LogWorkModal } from "@/components/LogWorkModal";
import { daysAgoIso } from "@/lib/analytics/aggregate";
import { listEventsForHistory, type EventWithResource } from "@/lib/db/queries";
import { formatMinutes, todayIso } from "@/lib/utils/time";
import { formatTimestamp, groupEventsByDate } from "@/lib/utils/history";
import { useProfileStore } from "@/store/profile";
import { useProjects } from "@/store/projects";
import { useWorkspaceStore } from "@/store/workspace";

type PersonFilter = "all" | string;

const RANGE_PRESETS: { label: string; days: number }[] = [
  { label: "7d", days: 6 },
  { label: "30d", days: 29 },
  { label: "90d", days: 89 },
];

export function HistoryView() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const memberships = useWorkspaceStore((s) => s.memberships);
  const getProfile = useProfileStore((s) => s.getProfile);
  const fetchProfiles = useProfileStore((s) => s.fetchProfiles);
  const { updateLog, deleteLog } = useProjects();

  const [fromIso, setFromIso] = useState(() => daysAgoIso(29));
  const [toIso, setToIso] = useState(() => todayIso());
  const [personFilter, setPersonFilter] = useState<PersonFilter>("all");
  const [events, setEvents] = useState<EventWithResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EventWithResource | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const workspaceMembers = useMemo(
    () => memberships.filter((member) => member.workspace_id === activeWorkspaceId),
    [activeWorkspaceId, memberships],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- person filter belongs to the active workspace
    setPersonFilter("all");
  }, [activeWorkspaceId]);

  useEffect(() => {
    const userIds = [
      ...new Set([
        ...workspaceMembers.map((member) => member.user_id),
        ...events.map((event) => event.user_id).filter((id): id is string => Boolean(id)),
      ]),
    ];
    if (userIds.length > 0) {
      void fetchProfiles(userIds);
    }
  }, [events, fetchProfiles, workspaceMembers]);

  useEffect(() => {
    if (activeWorkspaceId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear workspace-scoped history when no workspace is active
      setEvents([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void listEventsForHistory(
      activeWorkspaceId,
      fromIso,
      toIso,
      personFilter === "all" ? null : personFilter,
    )
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, fromIso, personFilter, reloadKey, toIso]);

  const groups = useMemo(() => groupEventsByDate(events, todayIso()), [events]);
  const totalMinutes = useMemo(
    () => events.reduce((sum, event) => sum + event.minutes, 0),
    [events],
  );

  const reload = () => setReloadKey((key) => key + 1);

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <header className="shrink-0 border-b border-neutral-800 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-neutral-100">Historia</h1>
            <p className="mt-1 text-xs text-neutral-500">
              {events.length} wpisów · {formatMinutes(totalMinutes)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={personFilter}
              onChange={(e) => setPersonFilter(e.target.value as PersonFilter)}
              className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-blue-500"
              aria-label="Filtr osoby"
            >
              <option value="all">Wszyscy</option>
              {workspaceMembers.map((member) => {
                const profile = getProfile(member.user_id);
                return (
                  <option key={member.user_id} value={member.user_id}>
                    {profile.display_name}
                  </option>
                );
              })}
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
            <div className="flex gap-1">
              {RANGE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setFromIso(daysAgoIso(preset.days));
                    setToIso(todayIso());
                  }}
                  className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {error && (
        <div className="shrink-0 border-b border-red-900 bg-red-950 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <main className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex h-32 items-center justify-center text-sm text-neutral-500">
            Ładowanie...
          </div>
        ) : groups.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-neutral-500">
            Brak wpisów dla wybranego zakresu.
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <section key={group.date}>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                    {group.label} · {group.date}
                  </h2>
                  <span className="text-[10px] text-neutral-600">
                    {formatMinutes(group.totalMinutes)}
                  </span>
                </div>

                <div className="space-y-2">
                  {group.events.map((event) => {
                    const profile = event.user_id ? getProfile(event.user_id) : null;
                    const edited = event.updated_at > event.created_at;

                    return (
                      <article
                        key={event.id}
                        className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            {profile && event.user_id ? (
                              <AvatarBadge
                                userId={event.user_id}
                                displayName={profile.display_name}
                                avatarUrl={profile.avatar_url}
                                size="xs"
                              />
                            ) : (
                              <span className="h-5 w-5 shrink-0 rounded-full bg-neutral-800" />
                            )}
                            <span className="truncate text-sm font-medium text-neutral-100">
                              {profile?.display_name ?? "Nieznany"}
                            </span>
                            <span className="truncate text-xs text-neutral-500">
                              → {event.resource_name}
                            </span>
                          </div>
                          <span className="shrink-0 text-sm font-semibold text-blue-400">
                            {formatMinutes(event.minutes)}
                          </span>
                        </div>

                        <div className="mt-2 space-y-1 text-xs text-neutral-400">
                          {event.goal && (
                            <p>
                              <span className="text-neutral-500">Cel:</span> {event.goal}
                            </p>
                          )}
                          {event.topics && (
                            <p>
                              <span className="text-neutral-500">Tematy:</span> {event.topics}
                            </p>
                          )}
                          {event.notes && (
                            <p>
                              <span className="text-neutral-500">Notatki:</span> {event.notes}
                            </p>
                          )}
                          {event.report && (
                            <p>
                              <span className="text-neutral-500">Raport:</span> {event.report}
                            </p>
                          )}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[10px] text-neutral-600">
                            log na {event.date} · wpisano {formatTimestamp(event.created_at)}
                            {edited ? ` · edytowano ${formatTimestamp(event.updated_at)}` : ""}
                          </span>
                          <div className="flex items-center gap-1">
                            {confirmingDeleteId === event.id ? (
                              <>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await deleteLog(event.id);
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
                                  onClick={() => setEditing(event)}
                                  className="rounded px-2 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                                >
                                  Edytuj
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmingDeleteId(event.id)}
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
            ))}
          </div>
        )}
      </main>

      {editing && (
        <LogWorkModal
          resourceName={editing.resource_name}
          event={editing}
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
