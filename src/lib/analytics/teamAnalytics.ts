import { getDb } from '@/lib/db/connection';

export interface MemberRow {
  userId: string;
  totalMinutes: number;
  projectBreakdown: Array<{ resourceId: string; resourceName: string; minutes: number }>;
}

export interface TeamReportProfile {
  user_id: string;
  display_name: string;
}

/**
 * Aggregates time event data per workspace member for the given date range.
 *
 * - Queries `events JOIN resources JOIN workspace_memberships` from local SQLite.
 * - Attributes events to members via `events.user_id`.
 * - Includes all workspace members even if they have 0 minutes (Requirement 6.8).
 * - Sorts rows descending by `totalMinutes` (Requirement 6.5).
 * - Computes per-top-level-project breakdown per member (Requirement 6.6).
 *
 * Offline-safe — reads only from local SQLite (Requirement 6.7).
 *
 * Requirements: 6.2, 6.5, 6.7, 6.8
 */
export async function computeMemberRows(
  workspaceId: string,
  startDate: string, // YYYY-MM-DD
  endDate: string,   // YYYY-MM-DD
): Promise<MemberRow[]> {
  const db = await getDb();

  // Fetch all members of the workspace
  const members = await db.select<Array<{ user_id: string }>>(
    `SELECT user_id FROM workspace_memberships WHERE workspace_id = $1`,
    [workspaceId],
  );

  if (members.length === 0) return [];

  // Fetch all active events in the date range for this workspace,
  // joined with resources to get the root project path.
  // events.user_id may be NULL for events created before Phase 6 migration.
  interface EventRow {
    user_id: string | null;
    minutes: number;
    root_resource_id: string;
    root_resource_name: string;
  }

  const eventRows = await db.select<EventRow[]>(
    `SELECT
       e.user_id,
       e.minutes,
       -- Extract root resource id from materialized path (first segment before '/')
       CASE
         WHEN instr(r.path, '/') > 0 THEN substr(r.path, 1, instr(r.path, '/') - 1)
         ELSE r.path
       END AS root_resource_id,
       root_r.name AS root_resource_name
     FROM events e
     JOIN resources r ON r.id = e.resource_id
     JOIN resources root_r ON root_r.id = (
       CASE
         WHEN instr(r.path, '/') > 0 THEN substr(r.path, 1, instr(r.path, '/') - 1)
         ELSE r.path
       END
     )
     WHERE e.deleted_at IS NULL
       AND r.deleted_at IS NULL
       AND e.workspace_id = $1
       AND e.date >= $2
       AND e.date <= $3
       AND e.user_id IS NOT NULL`,
    [workspaceId, startDate, endDate],
  );

  // Build per-member aggregates
  // Map: userId → { totalMinutes, projectBreakdown: Map<rootId, { name, minutes }> }
  const memberMap = new Map<
    string,
    { totalMinutes: number; projects: Map<string, { name: string; minutes: number }> }
  >();

  // Initialize all members with 0 minutes (Requirement 6.8)
  for (const { user_id } of members) {
    memberMap.set(user_id, { totalMinutes: 0, projects: new Map() });
  }

  // Aggregate event data
  for (const row of eventRows) {
    if (row.user_id === null) continue;

    const entry = memberMap.get(row.user_id);
    if (!entry) continue; // event belongs to a user not in this workspace — skip

    entry.totalMinutes += row.minutes;

    const existing = entry.projects.get(row.root_resource_id);
    if (existing) {
      existing.minutes += row.minutes;
    } else {
      entry.projects.set(row.root_resource_id, {
        name: row.root_resource_name,
        minutes: row.minutes,
      });
    }
  }

  // Build result rows
  const rows: MemberRow[] = [];
  for (const [userId, { totalMinutes, projects }] of memberMap) {
    const projectBreakdown = [...projects.entries()]
      .map(([resourceId, { name, minutes }]) => ({
        resourceId,
        resourceName: name,
        minutes,
      }))
      .sort((a, b) => b.minutes - a.minutes);

    rows.push({ userId, totalMinutes, projectBreakdown });
  }

  // Sort descending by totalMinutes (Requirement 6.5)
  rows.sort((a, b) => b.totalMinutes - a.totalMinutes);

  return rows;
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

export function teamRowsToCsv(
  rows: MemberRow[],
  profiles: TeamReportProfile[],
): string {
  const lines = ['member,project,minutes,hours'];

  for (const row of rows) {
    const name = memberName(row.userId, profiles);
    if (row.projectBreakdown.length === 0) {
      lines.push([name, '', '0', '0.00'].map(escapeCsv).join(','));
      continue;
    }

    for (const project of row.projectBreakdown) {
      lines.push(
        [
          name,
          project.resourceName,
          String(project.minutes),
          formatHours(project.minutes),
        ].map(escapeCsv).join(','),
      );
    }
  }

  return lines.join('\n');
}

export function teamRowsToMarkdown(
  rows: MemberRow[],
  profiles: TeamReportProfile[],
  range: { from: string; to: string },
): string {
  const total = rows.reduce((sum, row) => sum + row.totalMinutes, 0);
  const lines = [
    `# Team report: ${range.from} to ${range.to}`,
    '',
    `Total: ${total} min (${formatHours(total)} h)`,
    '',
    '| Member | Project | Minutes | Hours |',
    '| --- | --- | ---: | ---: |',
  ];

  for (const row of rows) {
    const name = memberName(row.userId, profiles);
    if (row.projectBreakdown.length === 0) {
      lines.push(`| ${name} | - | 0 | 0.00 |`);
      continue;
    }

    for (const project of row.projectBreakdown) {
      lines.push(
        `| ${name} | ${project.resourceName} | ${project.minutes} | ${formatHours(project.minutes)} |`,
      );
    }
  }

  return lines.join('\n');
}
