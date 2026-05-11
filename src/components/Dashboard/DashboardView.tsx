import { useEffect, useMemo, useState } from "react";
import { useProjects } from "@/store/projects";
import {
  aggregate,
  daysAgoIso,
  fillDailyGaps,
  type RangeStats,
} from "@/lib/analytics/aggregate";
import { todayIso } from "@/lib/utils/time";
import { useEventsRange } from "@/lib/hooks/useEventsRange";
import { downloadCsv, eventsToCsv } from "@/lib/utils/csv";
import { rootIdOfPath } from "@/lib/analytics/aggregate";
import { StatsCard } from "./StatsCard";
import { ProjectsPieChart } from "./ProjectsPieChart";
import { DailyBarChart } from "./DailyBarChart";

const RANGE_PRESETS: { label: string; days: number }[] = [
  { label: "7d", days: 6 },
  { label: "30d", days: 29 },
  { label: "90d", days: 89 },
  { label: "365d", days: 364 },
];

export function DashboardView() {
  const { resources, refresh } = useProjects();
  const [fromIso, setFromIso] = useState(() => daysAgoIso(29));
  const [toIso, setToIso] = useState(() => todayIso());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { events, loading, error } = useEventsRange(fromIso, toIso);

  // Make sure resources are loaded once.
  useEffect(() => {
    if (resources.length === 0) void refresh();
  }, [resources.length, refresh]);

  const projects = useMemo(
    () => resources.filter((r) => r.type === "project"),
    [resources],
  );

  const stats: RangeStats = useMemo(
    () => aggregate(events, resources, selected),
    [events, resources, selected],
  );

  const filledDaily = useMemo(
    () => fillDailyGaps(stats.byDate, fromIso, toIso),
    [stats.byDate, fromIso, toIso],
  );

  // Quick stats: today / week / month from full events list (re-aggregate).
  const todayStr = todayIso();
  const weekFrom = daysAgoIso(6);
  const monthFrom = daysAgoIso(29);
  const minutesIn = (from: string, to: string): number =>
    events
      .filter((e) => e.date >= from && e.date <= to)
      .reduce((sum, e) => sum + e.minutes, 0);

  const toggleProject = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const clearSelection = () => setSelected(new Set());

  const handleExportCsv = () => {
    const filtered =
      selected.size === 0
        ? events
        : events.filter((e) => selected.has(rootIdOfPath(e.resource_path)));
    if (filtered.length === 0) return;
    const csv = eventsToCsv(filtered);
    downloadCsv(`tracker-${fromIso}_to_${toIso}.csv`, csv);
  };

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 px-4 py-3">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-neutral-500">Zakres:</span>
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
          <div className="ml-2 flex gap-1">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setFromIso(daysAgoIso(p.days));
                  setToIso(todayIso());
                }}
                className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={events.length === 0}
            className="ml-auto rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-40"
            title="Eksport widocznych eventów do CSV"
          >
            Eksport CSV
          </button>
        </div>

        {projects.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[10px] uppercase tracking-wide text-neutral-500">
              Projekty:
            </span>
            <button
              type="button"
              onClick={clearSelection}
              className={`rounded border px-2 py-0.5 text-[11px] ${
                selected.size === 0
                  ? "border-blue-500 bg-blue-900/40 text-blue-300"
                  : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"
              }`}
            >
              Wszystkie
            </button>
            {projects.map((p) => {
              const isOn = selected.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleProject(p.id)}
                  className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors ${
                    isOn
                      ? "border-blue-500 bg-blue-900/40 text-blue-200"
                      : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-sm"
                    style={{ backgroundColor: p.color ?? "#6b7280" }}
                  />
                  {p.name}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {error && (
        <div className="border-b border-red-900 bg-red-950 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <main className="flex-1 overflow-auto p-4">
        <div className="mb-4 grid grid-cols-4 gap-3">
          <StatsCard label="Dzisiaj" minutes={minutesIn(todayStr, todayStr)} />
          <StatsCard label="Ten tydzień" minutes={minutesIn(weekFrom, todayStr)} hint="7 dni" />
          <StatsCard label="Ten miesiąc" minutes={minutesIn(monthFrom, todayStr)} hint="30 dni" />
          <StatsCard
            label="W zakresie"
            minutes={stats.totalMinutes}
            hint={`${fromIso} → ${toIso}`}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <ProjectsPieChart data={stats.byProject} />
          <DailyBarChart data={filledDaily} />
        </div>

        {loading && (
          <div className="mt-4 text-center text-xs text-neutral-500">Ładowanie...</div>
        )}
      </main>
    </div>
  );
}
