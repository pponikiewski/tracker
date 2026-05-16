import { getDb } from "@/lib/db/connection";
import type { ResourceType } from "@/lib/db/types";

export interface TeamEventEntry {
  id: string;
  date: string;
  minutes: number;
  goal: string | null;
  topics: string | null;
  notes: string | null;
  report: string | null;
}

export interface TeamResourceBreakdown {
  resourceId: string;
  resourceName: string;
  resourceType: ResourceType;
  minutes: number;
  events: TeamEventEntry[];
  children: TeamResourceBreakdown[];
}

export interface MemberRow {
  userId: string;
  totalMinutes: number;
  projectBreakdown: TeamResourceBreakdown[];
}

export interface TeamReportProfile {
  user_id: string;
  display_name: string;
}

/**
 * Aggregates time event data per workspace member for the given date range.
 *
 * - Includes all workspace members even if they have 0 minutes.
 * - Attributes events to members via `events.user_id`.
 * - Builds a drill-down tree: project -> stage -> substage/task -> event entries.
 * - Sorts rows descending by `totalMinutes`.
 *
 * Offline-safe: reads only from local SQLite.
 */
export async function computeMemberRows(
  workspaceId: string,
  startDate: string,
  endDate: string,
): Promise<MemberRow[]> {
  const db = await getDb();

  const members = await db.select<Array<{ user_id: string }>>(
    `SELECT user_id FROM workspace_memberships WHERE workspace_id = $1`,
    [workspaceId],
  );

  if (members.length === 0) return [];

  interface ResourceRow {
    id: string;
    parent_id: string | null;
    name: string;
    type: ResourceType;
    path: string;
  }

  const resources = await db.select<ResourceRow[]>(
    `SELECT id, parent_id, name, type, path
     FROM resources
     WHERE workspace_id = $1
       AND deleted_at IS NULL`,
    [workspaceId],
  );

  const resourceById = new Map(resources.map((resource) => [resource.id, resource]));

  interface EventRow {
    id: string;
    user_id: string | null;
    resource_id: string;
    date: string;
    minutes: number;
    goal: string | null;
    topics: string | null;
    notes: string | null;
    report: string | null;
  }

  const eventRows = await db.select<EventRow[]>(
    `SELECT
       e.id,
       e.user_id,
       e.resource_id,
       e.date,
       e.minutes,
       e.goal,
       e.topics,
       e.notes,
       e.report
     FROM events e
     JOIN resources r ON r.id = e.resource_id
     WHERE e.deleted_at IS NULL
       AND r.deleted_at IS NULL
       AND e.workspace_id = $1
       AND e.date >= $2
       AND e.date <= $3
       AND e.user_id IS NOT NULL`,
    [workspaceId, startDate, endDate],
  );

  interface MutableResourceBreakdown {
    resourceId: string;
    resourceName: string;
    resourceType: ResourceType;
    parentId: string | null;
    path: string;
    minutes: number;
    events: TeamEventEntry[];
  }

  const memberMap = new Map<
    string,
    { totalMinutes: number; resources: Map<string, MutableResourceBreakdown> }
  >();

  for (const { user_id } of members) {
    memberMap.set(user_id, { totalMinutes: 0, resources: new Map() });
  }

  for (const row of eventRows) {
    const entry = row.user_id ? memberMap.get(row.user_id) : null;
    if (!entry) continue;

    const eventResource = resourceById.get(row.resource_id);
    if (!eventResource) continue;

    entry.totalMinutes += row.minutes;

    for (const resourceId of eventResource.path.split("/").filter(Boolean)) {
      const resource = resourceById.get(resourceId);
      if (!resource) continue;

      const existing = entry.resources.get(resourceId);
      if (existing) {
        existing.minutes += row.minutes;
      } else {
        entry.resources.set(resourceId, {
          resourceId,
          resourceName: resource.name,
          resourceType: resource.type,
          parentId: resource.parent_id,
          path: resource.path,
          minutes: row.minutes,
          events: [],
        });
      }
    }

    entry.resources.get(row.resource_id)?.events.push({
      id: row.id,
      date: row.date,
      minutes: row.minutes,
      goal: row.goal,
      topics: row.topics,
      notes: row.notes,
      report: row.report,
    });
  }

  const rows: MemberRow[] = [];
  for (const [userId, { totalMinutes, resources: memberResources }] of memberMap) {
    rows.push({
      userId,
      totalMinutes,
      projectBreakdown: buildResourceTree(memberResources),
    });
  }

  rows.sort((a, b) => b.totalMinutes - a.totalMinutes);

  return rows;
}

function buildResourceTree(
  resources: Map<
    string,
    {
      resourceId: string;
      resourceName: string;
      resourceType: ResourceType;
      parentId: string | null;
      path: string;
      minutes: number;
      events: TeamEventEntry[];
    }
  >,
): TeamResourceBreakdown[] {
  const nodes = new Map<string, TeamResourceBreakdown>();
  const roots: TeamResourceBreakdown[] = [];

  for (const resource of resources.values()) {
    nodes.set(resource.resourceId, {
      resourceId: resource.resourceId,
      resourceName: resource.resourceName,
      resourceType: resource.resourceType,
      minutes: resource.minutes,
      events: resource.events.sort((a, b) => b.date.localeCompare(a.date)),
      children: [],
    });
  }

  const orderedResources = [...resources.values()].sort(
    (a, b) => a.path.split("/").length - b.path.split("/").length,
  );

  for (const resource of orderedResources) {
    const node = nodes.get(resource.resourceId);
    if (!node) continue;

    const parent = resource.parentId ? nodes.get(resource.parentId) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  sortResourceBreakdown(roots);
  return roots;
}

function sortResourceBreakdown(nodes: TeamResourceBreakdown[]): void {
  nodes.sort((a, b) => b.minutes - a.minutes || a.resourceName.localeCompare(b.resourceName));
  for (const node of nodes) {
    sortResourceBreakdown(node.children);
  }
}

function memberName(userId: string, profiles: TeamReportProfile[]): string {
  return profiles.find((p) => p.user_id === userId)?.display_name ?? userId;
}

function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

function escapeCsv(value: string): string {
  const needsQuote = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

export function teamRowsToCsv(rows: MemberRow[], profiles: TeamReportProfile[]): string {
  const lines = ["member,project,minutes,hours"];

  for (const row of rows) {
    const name = memberName(row.userId, profiles);
    if (row.projectBreakdown.length === 0) {
      lines.push([name, "", "0", "0.00"].map(escapeCsv).join(","));
      continue;
    }

    for (const project of row.projectBreakdown) {
      lines.push(
        [name, project.resourceName, String(project.minutes), formatHours(project.minutes)]
          .map(escapeCsv)
          .join(","),
      );
    }
  }

  return lines.join("\n");
}

export function teamRowsToMarkdown(
  rows: MemberRow[],
  profiles: TeamReportProfile[],
  range: { from: string; to: string },
): string {
  const total = rows.reduce((sum, row) => sum + row.totalMinutes, 0);
  const lines = [
    `# Team report: ${range.from} to ${range.to}`,
    "",
    `Total: ${total} min (${formatHours(total)} h)`,
    "",
    "| Member | Project | Minutes | Hours |",
    "| --- | --- | ---: | ---: |",
  ];

  for (const row of rows) {
    const name = escapeMarkdownCell(memberName(row.userId, profiles));
    if (row.projectBreakdown.length === 0) {
      lines.push(`| ${name} | - | 0 | 0.00 |`);
      continue;
    }

    for (const project of row.projectBreakdown) {
      lines.push(
        `| ${name} | ${escapeMarkdownCell(project.resourceName)} | ${project.minutes} | ${formatHours(project.minutes)} |`,
      );
    }
  }

  return lines.join("\n");
}
