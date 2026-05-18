import { describe, expect, it } from "vitest";
import type { EventWithResource } from "@/lib/db/queries";
import type { Resource } from "@/lib/db/types";
import {
  aggregate,
  aggregateResourceBreakdown,
  filterEventsByProjects,
} from "@/lib/analytics/aggregate";

function resource(partial: Partial<Resource>): Resource {
  return {
    id: "p1",
    workspace_id: "w1",
    parent_id: null,
    name: "Project",
    type: "project",
    color: null,
    path: "p1",
    cached_minutes: 0,
    created_at: 1_000,
    updated_at: 1_000,
    deleted_at: null,
    ...partial,
  };
}

function event(partial: Partial<EventWithResource>): EventWithResource {
  return {
    id: "e1",
    workspace_id: "w1",
    resource_id: "r1",
    date: "2026-05-14",
    minutes: 30,
    goal: null,
    topics: null,
    notes: null,
    report: null,
    user_id: "u1",
    created_at: 1_000,
    updated_at: 1_000,
    deleted_at: null,
    resource_name: "Task",
    resource_path: "p1/r1",
    ...partial,
  };
}

describe("filterEventsByProjects", () => {
  it("keeps only events from selected root projects", () => {
    const events = [
      event({ id: "a", resource_path: "p1/t1", minutes: 30 }),
      event({ id: "b", resource_path: "p2/t2", minutes: 45 }),
      event({ id: "c", resource_path: "p1/stage/t3", minutes: 15 }),
    ];

    expect(filterEventsByProjects(events, new Set(["p1"])).map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("keeps all events when no project is selected", () => {
    const events = [event({ id: "a", resource_path: "p1/t1" })];

    expect(filterEventsByProjects(events, new Set())).toBe(events);
  });
});

describe("aggregate", () => {
  it("applies project selection to totals and daily stats", () => {
    const resources = [
      resource({ id: "p1", name: "Alpha" }),
      resource({ id: "p2", name: "Beta" }),
    ];
    const events = [
      event({ id: "a", resource_path: "p1/t1", date: "2026-05-14", minutes: 30 }),
      event({ id: "b", resource_path: "p2/t2", date: "2026-05-14", minutes: 45 }),
      event({ id: "c", resource_path: "p1/t3", date: "2026-05-15", minutes: 15 }),
    ];

    const stats = aggregate(events, resources, new Set(["p1"]));

    expect(stats.totalMinutes).toBe(45);
    expect(stats.byProject).toEqual([
      { projectId: "p1", projectName: "Alpha", color: "#6b7280", minutes: 45 },
    ]);
    expect(stats.byDate).toEqual([
      { date: "2026-05-14", minutes: 30 },
      { date: "2026-05-15", minutes: 15 },
    ]);
  });
});

describe("aggregateResourceBreakdown", () => {
  it("breaks a selected resource into direct time and child subtrees", () => {
    const resources = [
      resource({ id: "p1", name: "Alpha", path: "p1" }),
      resource({ id: "s1", parent_id: "p1", name: "Stage", type: "stage", path: "p1/s1" }),
      resource({ id: "t1", parent_id: "s1", name: "Task", type: "task", path: "p1/s1/t1" }),
      resource({ id: "t2", parent_id: "p1", name: "Loose task", type: "task", path: "p1/t2" }),
    ];
    const events = [
      event({ id: "direct", resource_id: "p1", resource_path: "p1", minutes: 10 }),
      event({ id: "nested", resource_id: "t1", resource_path: "p1/s1/t1", minutes: 40 }),
      event({ id: "child", resource_id: "t2", resource_path: "p1/t2", minutes: 20 }),
    ];

    const breakdown = aggregateResourceBreakdown(events, resources, "p1");

    expect(breakdown.current?.id).toBe("p1");
    expect(breakdown.items).toEqual([
      {
        id: "p1:direct",
        resourceId: "p1",
        name: "Bezpośrednio na projekcie",
        color: "#6b7280",
        minutes: 10,
        hasChildren: false,
        isDirect: true,
        resourceType: "project",
      },
      {
        id: "s1",
        resourceId: "s1",
        name: "Stage",
        color: "#6b7280",
        minutes: 40,
        hasChildren: true,
        isDirect: false,
        resourceType: "stage",
      },
      {
        id: "t2",
        resourceId: "t2",
        name: "Loose task",
        color: "#6b7280",
        minutes: 20,
        hasChildren: false,
        isDirect: false,
        resourceType: "task",
      },
    ]);
  });
});
