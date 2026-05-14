import { describe, expect, it, vi } from 'vitest';
import {
  computeMemberRows,
  teamRowsToCsv,
  teamRowsToMarkdown,
  type MemberRow,
} from '../teamAnalytics';

const select = vi.fn();

vi.mock('@/lib/db/connection', () => ({
  getDb: async () => ({ select }),
}));

describe('computeMemberRows', () => {
  it('includes zero-minute members and sorts active members first', async () => {
    select.mockReset();
    select
      .mockResolvedValueOnce([{ user_id: 'u1' }, { user_id: 'u2' }])
      .mockResolvedValueOnce([
        {
          user_id: 'u1',
          minutes: 45,
          root_resource_id: 'p1',
          root_resource_name: 'Client A',
        },
        {
          user_id: 'u1',
          minutes: 30,
          root_resource_id: 'p1',
          root_resource_name: 'Client A',
        },
      ]);

    const rows = await computeMemberRows('ws1', '2026-05-01', '2026-05-07');

    expect(rows).toEqual([
      {
        userId: 'u1',
        totalMinutes: 75,
        projectBreakdown: [{ resourceId: 'p1', resourceName: 'Client A', minutes: 75 }],
      },
      {
        userId: 'u2',
        totalMinutes: 0,
        projectBreakdown: [],
      },
    ]);
  });
});

describe('team report exports', () => {
  const rows: MemberRow[] = [
    {
      userId: 'u1',
      totalMinutes: 90,
      projectBreakdown: [{ resourceId: 'p1', resourceName: 'Client A', minutes: 90 }],
    },
    {
      userId: 'u2',
      totalMinutes: 0,
      projectBreakdown: [],
    },
  ];
  const profiles = [
    { user_id: 'u1', display_name: 'Ala' },
    { user_id: 'u2', display_name: 'Bartek' },
  ];

  it('exports team rows to CSV', () => {
    expect(teamRowsToCsv(rows, profiles)).toBe(
      [
        'member,project,minutes,hours',
        'Ala,Client A,90,1.50',
        'Bartek,,0,0.00',
      ].join('\n'),
    );
  });

  it('exports team rows to Markdown with total', () => {
    const md = teamRowsToMarkdown(rows, profiles, {
      from: '2026-05-01',
      to: '2026-05-07',
    });

    expect(md).toContain('# Team report: 2026-05-01 to 2026-05-07');
    expect(md).toContain('Total: 90 min (1.50 h)');
    expect(md).toContain('| Ala | Client A | 90 | 1.50 |');
    expect(md).toContain('| Bartek | - | 0 | 0.00 |');
  });
});
