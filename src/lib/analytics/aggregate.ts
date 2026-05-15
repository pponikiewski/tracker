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

export interface ResourceTimeStat {
  id: string;
  resourceId: string;
  name: string;
  color: string;
  minutes: number;
  hasChildren: boolean;
  isDirect: boolean;
}

export interface ResourceBreakdown {
  current: Resource | null;
  ancestors: Resource[];
  items: ResourceTimeStat[];
}

/** Extract root project id from materialized path "id1/id2/id3" to "id1". */
export function rootIdOfPath(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? path : path.slice(0, slash);
}

export function filterEventsByProjects(
  events: EventWithResource[],
  selectedProjectIds: Set<string>,
): EventWithResource[] {
  if (selectedProjectIds.size === 0) return events;
  return events.filter((event) => selectedProjectIds.has(rootIdOfPath(event.resource_path)));
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

  const filteredEvents = selectedProjectIds
    ? filterEventsByProjects(events, selectedProjectIds)
    : events;

  for (const e of filteredEvents) {
    const rootId = rootIdOfPath(e.resource_path);
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

function isInPath(resourcePath: string, ancestorPath: string): boolean {
  return resourcePath === ancestorPath || resourcePath.startsWith(`${ancestorPath}/`);
}

function minutesInSubtree(events: EventWithResource[], resourcePath: string): number {
  return events
    .filter((event) => isInPath(event.resource_path, resourcePath))
    .reduce((sum, event) => sum + event.minutes, 0);
}

function directLabel(resource: Resource): string {
  switch (resource.type) {
    case "project":
      return "Bezpośrednio na projekcie";
    case "stage":
      return "Bezpośrednio na etapie";
    case "substage":
      return "Bezpośrednio na podetapie";
    case "task":
      return "Bezpośrednio na zadaniu";
  }
}

export function aggregateResourceBreakdown(
  events: EventWithResource[],
  resources: Resource[],
  currentResourceId: string | null,
): ResourceBreakdown {
  const resourceMap = new Map(resources.map((resource) => [resource.id, resource]));
  const current = currentResourceId ? (resourceMap.get(currentResourceId) ?? null) : null;
  const childCount = new Map<string, number>();

  for (const resource of resources) {
    if (!resource.parent_id) continue;
    childCount.set(resource.parent_id, (childCount.get(resource.parent_id) ?? 0) + 1);
  }

  const ancestors = current
    ? current.path
        .split("/")
        .slice(0, -1)
        .map((id) => resourceMap.get(id))
        .filter((resource): resource is Resource => Boolean(resource))
    : [];

  const children = resources.filter((resource) =>
    current ? resource.parent_id === current.id : resource.parent_id === null,
  );

  const childItems = children
    .map<ResourceTimeStat>((resource) => ({
      id: resource.id,
      resourceId: resource.id,
      name: resource.name,
      color: resource.color ?? DEFAULT_COLOR,
      minutes: minutesInSubtree(events, resource.path),
      hasChildren: (childCount.get(resource.id) ?? 0) > 0,
      isDirect: false,
    }))
    .filter((item) => item.minutes > 0);

  const directMinutes = current
    ? events
        .filter((event) => event.resource_id === current.id)
        .reduce((sum, event) => sum + event.minutes, 0)
    : 0;

  const directItem: ResourceTimeStat[] =
    current && directMinutes > 0
      ? [
          {
            id: `${current.id}:direct`,
            resourceId: current.id,
            name: directLabel(current),
            color: current.color ?? DEFAULT_COLOR,
            minutes: directMinutes,
            hasChildren: false,
            isDirect: true,
          },
        ]
      : [];

  return {
    current,
    ancestors,
    items: [...directItem, ...childItems].sort((a, b) => {
      if (a.isDirect !== b.isDirect) return a.isDirect ? -1 : 1;
      return b.minutes - a.minutes;
    }),
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
