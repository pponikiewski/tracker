import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { ProjectStat } from "@/lib/analytics/aggregate";
import { formatMinutes } from "@/lib/utils/time";

interface Props {
  data: ProjectStat[];
}

export function ProjectsPieChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-md border border-neutral-800 bg-neutral-900 text-sm text-neutral-500">
        Brak danych
      </div>
    );
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Czas wg projektów
      </h3>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={data}
            dataKey="minutes"
            nameKey="projectName"
            innerRadius={50}
            outerRadius={90}
            paddingAngle={2}
            stroke="none"
          >
            {data.map((d) => (
              <Cell key={d.projectId} fill={d.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "#0a0a0a",
              border: "1px solid #404040",
              borderRadius: 6,
              fontSize: 12,
            }}
            formatter={(value, name) => [formatMinutes(Number(value)), String(name)]}
          />
        </PieChart>
      </ResponsiveContainer>

      <ul className="mt-2 space-y-1 text-xs">
        {data.map((d) => (
          <li key={d.projectId} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: d.color }}
            />
            <span className="flex-1 truncate text-neutral-300">{d.projectName}</span>
            <span className="tabular-nums text-neutral-400">{formatMinutes(d.minutes)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
