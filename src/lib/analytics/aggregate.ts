import type { EventWithResource } from "@/lib/db/queries";
import type { Resource } from "@/lib/db/types";

const DEFAULT_COLOR = "#6b7280";

export interface ProjectStat {
  projectId: string;
  projectName: string;
  color: string;
  minutes: number;
}

export interface DailyStat {
  date: string;
  minutes: number;
}

export interface RangeStats {
  totalMinutes: number;
  byProject: ProjectStat[];
  byDate: DailyStat[];
}

/** Extract root project id from materialized path "id1/id2/id3" → "id1". */
export function rootIdOfPath(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? path : path.slice(0, slash);
}

/**
 * Aggregate events by root project and by date.
 * `projects` provides name + color resolution for each root.
 */
export function aggregate(
  events: EventWithResource[],
  projects: Resource[],
  selectedProjectIds?: Set<string>,
): RangeStats {
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const byProject = new Map<string, ProjectStat>();
  const byDate = new Map<string, number>();
  let total = 0;

  for (const e of events) {
    const rootId = rootIdOfPath(e.resource_path);
    if (selectedProjectIds && selectedProjectIds.size > 0 && !selectedProjectIds.has(rootId)) {
      continue;
    }
    const project = projectMap.get(rootId);
    const name = project?.name ?? "(usunięty projekt)";
    const color = project?.color ?? DEFAULT_COLOR;

    total += e.minutes;
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.minutes);

    const existing = byProject.get(rootId);
    if (existing) {
      existing.minutes += e.minutes;
    } else {
      byProject.set(rootId, { projectId: rootId, projectName: name, color, minutes: e.minutes });
    }
  }

  return {
    totalMinutes: total,
    byProject: [...byProject.values()].sort((a, b) => b.minutes - a.minutes),
    byDate: [...byDate.entries()]
      .map(([date, minutes]) => ({ date, minutes }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** ISO YYYY-MM-DD for N days ago (local time). */
export function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Fill missing days in byDate with 0 minutes for continuous bar charts. */
export function fillDailyGaps(byDate: DailyStat[], fromIso: string, toIso: string): DailyStat[] {
  const map = new Map(byDate.map((d) => [d.date, d.minutes]));
  const result: DailyStat[] = [];
  const start = new Date(fromIso);
  const end = new Date(toIso);
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const day = String(cur.getDate()).padStart(2, "0");
    const iso = `${y}-${m}-${day}`;
    result.push({ date: iso, minutes: map.get(iso) ?? 0 });
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}
