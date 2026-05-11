import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyStat } from "@/lib/analytics/aggregate";
import { formatMinutes } from "@/lib/utils/time";

interface Props {
  data: DailyStat[];
}

function formatXTick(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function DailyBarChart({ data }: Props) {
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
        Czas dziennie (minuty)
      </h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={formatXTick}
            stroke="#525252"
            fontSize={10}
          />
          <YAxis stroke="#525252" fontSize={10} />
          <Tooltip
            contentStyle={{
              backgroundColor: "#0a0a0a",
              border: "1px solid #404040",
              borderRadius: 6,
              fontSize: 12,
            }}
            labelStyle={{ color: "#a3a3a3" }}
            formatter={(value) => [formatMinutes(Number(value)), "Czas"]}
          />
          <Bar dataKey="minutes" fill="#3b82f6" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
