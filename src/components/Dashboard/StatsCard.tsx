import { formatMinutes } from "@/lib/utils/time";

interface Props {
  label: string;
  minutes: number;
  hint?: string;
}

export function StatsCard({ label, minutes, hint }: Props) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-neutral-100">
        {minutes > 0 ? formatMinutes(minutes) : "—"}
      </div>
      {hint && <div className="mt-0.5 text-[10px] text-neutral-600">{hint}</div>}
    </div>
  );
}
