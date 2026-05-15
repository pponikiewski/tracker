import { describe, expect, it, vi } from "vitest";
import {
  computeMemberRows,
  teamRowsToCsv,
  teamRowsToMarkdown,
  type MemberRow,
} from "../teamAnalytics";

const select = vi.fn();

vi.mock("@/lib/db/connection", () => ({
  getDb: async () => ({ select }),
}));

describe("computeMemberRows", () => {
  it("includes zero-minute members and sorts active members first", async () => {
    select.mockReset();
    select
      .mockResolvedValueOnce([{ user_id: "u1" }, { user_id: "u2" }])
      .mockResolvedValueOnce([
        {
          id: "p1",
          parent_id: null,
          name: "Client A",
          type: "project",
          path: "p1",
        },
        {
          id: "s1",
          parent_id: "p1",
          name: "Discovery",
          type: "stage",
          path: "p1/s1",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "e1",
          user_id: "u1",
          resource_id: "s1",
          date: "2026-05-02",
          minutes: 45,
          goal: "Plan",
          topics: null,
          notes: null,
          report: null,
        },
        {
          id: "e2",
          user_id: "u1",
          resource_id: "p1",
          date: "2026-05-01",
          minutes: 30,
          goal: "Kickoff",
          topics: null,
          notes: null,
          report: null,
        },
      ]);

    const rows = await computeMemberRows("ws1", "2026-05-01", "2026-05-07");

    expect(rows).toEqual([
      {
        userId: "u1",
        totalMinutes: 75,
        projectBreakdown: [
          {
            resourceId: "p1",
            resourceName: "Client A",
            resourceType: "project",
            minutes: 75,
            events: [
              {
                id: "e2",
                date: "2026-05-01",
                minutes: 30,
                goal: "Kickoff",
                topics: null,
                notes: null,
                report: null,
              },
            ],
            children: [
              {
                resourceId: "s1",
                resourceName: "Discovery",
                resourceType: "stage",
                minutes: 45,
                events: [
                  {
                    id: "e1",
                    date: "2026-05-02",
                    minutes: 45,
                    goal: "Plan",
                    topics: null,
                    notes: null,
                    report: null,
                  },
                ],
                children: [],
              },
            ],
          },
        ],
      },
      {
        userId: "u2",
        totalMinutes: 0,
        projectBreakdown: [],
      },
    ]);
  });
});

describe("team report exports", () => {
  const rows: MemberRow[] = [
    {
      userId: "u1",
      totalMinutes: 90,
      projectBreakdown: [
        {
          resourceId: "p1",
          resourceName: "Client A",
          resourceType: "project",
          minutes: 90,
          events: [],
          children: [],
        },
      ],
    },
    {
      userId: "u2",
      totalMinutes: 0,
      projectBreakdown: [],
    },
  ];
  const profiles = [
    { user_id: "u1", display_name: "Ala" },
    { user_id: "u2", display_name: "Bartek" },
  ];

  it("exports team rows to CSV", () => {
    expect(teamRowsToCsv(rows, profiles)).toBe(
      ["member,project,minutes,hours", "Ala,Client A,90,1.50", "Bartek,,0,0.00"].join("\n"),
    );
  });

  it("exports team rows to Markdown with total", () => {
    const md = teamRowsToMarkdown(rows, profiles, {
      from: "2026-05-01",
      to: "2026-05-07",
    });

    expect(md).toContain("# Team report: 2026-05-01 to 2026-05-07");
    expect(md).toContain("Total: 90 min (1.50 h)");
    expect(md).toContain("| Ala | Client A | 90 | 1.50 |");
    expect(md).toContain("| Bartek | - | 0 | 0.00 |");
  });
});
