import { useEffect, useState, useCallback, useMemo } from "react";
import { useWorkspaceStore } from "@/store/workspace";
import { useProfileStore } from "@/store/profile";
import {
  computeMemberRows,
  teamRowsToCsv,
  teamRowsToMarkdown,
  type MemberRow,
  type TeamReportProfile,
} from "@/lib/analytics/teamAnalytics";
import { AvatarBadge } from "@/components/Profile/AvatarBadge";
import { formatMinutes } from "@/lib/utils/time";
import { todayIso } from "@/lib/utils/time";
import { daysAgoIso } from "@/lib/analytics/aggregate";
import { downloadCsv, downloadText } from "@/lib/utils/csv";

// ---- Date range presets ----

type Preset = "today" | "week" | "month" | "custom";

interface DateRange {
  from: string;
  to: string;
}

function getPresetRange(preset: Exclude<Preset, "custom">): DateRange {
  const today = todayIso();
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "week":
      return { from: daysAgoIso(6), to: today };
    case "month":
      return { from: daysAgoIso(29), to: today };
  }
}

// ---- MemberRowItem component ----

interface MemberRowItemProps {
  row: MemberRow;
}

function MemberRowItem({ row }: MemberRowItemProps) {
  const [expanded, setExpanded] = useState(false);
  const getProfile = useProfileStore((s) => s.getProfile);
  const profile = getProfile(row.userId);

  return (
    <li className="border border-neutral-700 rounded overflow-hidden">
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3 bg-neutral-800 hover:bg-neutral-750 transition-colors">
        <AvatarBadge
          userId={row.userId}
          displayName={profile.display_name}
          avatarUrl={profile.avatar_url}
          size="sm"
        />
        <span className="flex-1 text-sm text-neutral-100 truncate min-w-0">
          {profile.display_name}
        </span>
        <span className="text-sm font-medium text-neutral-200 shrink-0 tabular-nums">
          {row.totalMinutes === 0 ? "0 min" : formatMinutes(row.totalMinutes)}
        </span>
        {row.projectBreakdown.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-2 text-neutral-500 hover:text-neutral-200 transition-colors shrink-0 text-xs"
            aria-label={expanded ? "Zwiń" : "Rozwiń"}
            aria-expanded={expanded}
          >
            {expanded ? "▲" : "▼"}
          </button>
        )}
        {row.projectBreakdown.length === 0 && (
          // Spacer to keep alignment consistent
          <span className="ml-2 w-4 shrink-0" />
        )}
      </div>

      {/* Per-project breakdown */}
      {expanded && row.projectBreakdown.length > 0 && (
        <ul className="border-t border-neutral-700 bg-neutral-900 divide-y divide-neutral-800">
          {row.projectBreakdown.map((proj) => (
            <li key={proj.resourceId} className="flex items-center justify-between px-4 py-2 pl-12">
              <span className="text-xs text-neutral-400 truncate min-w-0 mr-3">
                {proj.resourceName}
              </span>
              <span className="text-xs text-neutral-300 shrink-0 tabular-nums">
                {formatMinutes(proj.minutes)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// ---- TeamView ----

/**
 * Team analytics view showing per-member time aggregates for the active workspace.
 *
 * Requirements: 6.2, 6.3, 6.4, 6.6, 6.8, 6.9
 */
export function TeamView() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const memberships = useWorkspaceStore((s) => s.memberships);
  const fetchProfiles = useProfileStore((s) => s.fetchProfiles);
  const getProfile = useProfileStore((s) => s.getProfile);

  // ---- Date range state ----
  const [preset, setPreset] = useState<Preset>("week");
  const [customFrom, setCustomFrom] = useState(() => daysAgoIso(6));
  const [customTo, setCustomTo] = useState(() => todayIso());

  const dateRange: DateRange =
    preset === "custom" ? { from: customFrom, to: customTo } : getPresetRange(preset);

  // ---- Data state ----
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Load member rows ----
  const loadRows = useCallback(async () => {
    if (!activeWorkspaceId) return;

    setLoading(true);
    setError(null);
    try {
      const result = await computeMemberRows(activeWorkspaceId, dateRange.from, dateRange.to);
      setRows(result);

      // Fetch profiles for all members in the result
      const userIds = result.map((r) => r.userId);
      if (userIds.length > 0) {
        await fetchProfiles(userIds);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nieznany błąd");
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, dateRange.from, dateRange.to, fetchProfiles]);

  // Reload when workspace changes or date range changes (Requirements 6.4, 6.9)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadRows owns async loading state for this view
    void loadRows();
  }, [loadRows]);

  // Also fetch profiles for all workspace members upfront (for members with 0 events)
  useEffect(() => {
    if (!activeWorkspaceId) return;
    const memberIds = memberships
      .filter((m) => m.workspace_id === activeWorkspaceId)
      .map((m) => m.user_id);
    if (memberIds.length > 0) {
      void fetchProfiles(memberIds);
    }
  }, [activeWorkspaceId, memberships, fetchProfiles]);

  const reportProfiles: TeamReportProfile[] = useMemo(
    () =>
      rows.map((row) => {
        const profile = getProfile(row.userId);
        return {
          user_id: row.userId,
          display_name: profile.display_name,
        };
      }),
    [rows, getProfile],
  );

  const exportCsv = () => {
    if (rows.length === 0) return;
    downloadCsv(
      `tracker-team-${dateRange.from}_to_${dateRange.to}.csv`,
      teamRowsToCsv(rows, reportProfiles),
    );
  };

  const exportMarkdown = () => {
    if (rows.length === 0) return;
    downloadText(
      `tracker-team-${dateRange.from}_to_${dateRange.to}.md`,
      teamRowsToMarkdown(rows, reportProfiles, dateRange),
    );
  };

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      {/* Header with date range selector */}
      <header className="border-b border-neutral-800 px-4 py-3 shrink-0">
        <h1 className="mb-3 text-lg font-semibold tracking-tight text-neutral-100">Zespół</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-neutral-500">Zakres:</span>

          {/* Preset buttons */}
          <div className="flex gap-1">
            <PresetButton active={preset === "today"} onClick={() => setPreset("today")}>
              Dziś
            </PresetButton>
            <PresetButton active={preset === "week"} onClick={() => setPreset("week")}>
              Ten tydzień
            </PresetButton>
            <PresetButton active={preset === "month"} onClick={() => setPreset("month")}>
              Ten miesiąc
            </PresetButton>
            <PresetButton active={preset === "custom"} onClick={() => setPreset("custom")}>
              Własny zakres
            </PresetButton>
          </div>

          {/* Custom date inputs — shown when Custom Range is selected */}
          {preset === "custom" && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-blue-500"
              />
              <span className="text-neutral-600">→</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-blue-500"
              />
            </>
          )}

          <div className="ml-auto flex gap-1">
            <button
              type="button"
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-40"
            >
              CSV
            </button>
            <button
              type="button"
              onClick={exportMarkdown}
              disabled={rows.length === 0}
              className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-40"
            >
              Markdown
            </button>
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="border-b border-red-900 bg-red-950 px-4 py-2 text-xs text-red-300 shrink-0">
          {error}
        </div>
      )}

      {/* Member rows */}
      <main className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-sm text-neutral-500">
            Ładowanie…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-neutral-500">
            Brak danych dla wybranego zakresu.
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <MemberRowItem key={row.userId} row={row} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

// ---- PresetButton helper ----

function PresetButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2 py-1 text-[11px] transition-colors ${
        active
          ? "border-blue-500 bg-blue-900/40 text-blue-300"
          : "border-neutral-700 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
      }`}
    >
      {children}
    </button>
  );
}
