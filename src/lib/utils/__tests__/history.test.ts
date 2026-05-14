import { describe, expect, it } from "vitest";
import type { EventWithResource } from "@/lib/db/queries";
import {
  dayGroupLabel,
  formatTimestamp,
  groupEventsByDate,
  isoMinusDays,
} from "@/lib/utils/history";

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

describe("isoMinusDays", () => {
  it("subtracts days across a month boundary", () => {
    expect(isoMinusDays("2026-05-01", 1)).toBe("2026-04-30");
  });

  it("returns the same date for zero days", () => {
    expect(isoMinusDays("2026-05-14", 0)).toBe("2026-05-14");
  });
});

describe("dayGroupLabel", () => {
  it("labels today", () => {
    expect(dayGroupLabel("2026-05-14", "2026-05-14")).toBe("Dzisiaj");
  });

  it("labels yesterday", () => {
    expect(dayGroupLabel("2026-05-13", "2026-05-14")).toBe("Wczoraj");
  });

  it("formats older dates", () => {
    expect(dayGroupLabel("2026-05-10", "2026-05-14")).toBe("10.05.2026");
  });
});

describe("groupEventsByDate", () => {
  it("buckets events per day, newest day first, summing minutes", () => {
    const events = [
      event({ id: "a", date: "2026-05-14", minutes: 30 }),
      event({ id: "b", date: "2026-05-14", minutes: 60 }),
      event({ id: "c", date: "2026-05-12", minutes: 15 }),
    ];

    const groups = groupEventsByDate(events, "2026-05-14");

    expect(groups.map((group) => group.date)).toEqual(["2026-05-14", "2026-05-12"]);
    expect(groups[0]!.label).toBe("Dzisiaj");
    expect(groups[0]!.events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(groups[0]!.totalMinutes).toBe(90);
    expect(groups[1]!.totalMinutes).toBe(15);
  });

  it("returns an empty array for no events", () => {
    expect(groupEventsByDate([], "2026-05-14")).toEqual([]);
  });
});

describe("formatTimestamp", () => {
  it("formats an epoch-ms value as DD.MM.YYYY HH:MM", () => {
    const ms = new Date(2026, 4, 14, 16, 42).getTime();
    expect(formatTimestamp(ms)).toBe("14.05.2026 16:42");
  });
});
