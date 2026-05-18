import { ChevronLeft } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { ResourceTimeStat } from "@/lib/analytics/aggregate";
import type { Resource } from "@/lib/db/types";
import { formatMinutes } from "@/lib/utils/time";

const typeLabels: Record<string, string> = {
  project: "projekt",
  stage: "etap",
  substage: "podetap",
  task: "zadanie",
};

interface Props {
  data: ResourceTimeStat[];
  current: Resource | null;
  ancestors: Resource[];
  onNavigate: (resourceId: string | null) => void;
}

export function ProjectsPieChart({ data, current, ancestors, onNavigate }: Props) {
  const title = current ? `Czas: ${current.name}` : "Czas wg projektów";
  const canGoBack = current !== null;

  const isResourceTimeStat = (value: unknown): value is ResourceTimeStat =>
    typeof value === "object" &&
    value !== null &&
    "resourceId" in value &&
    "minutes" in value &&
    "isDirect" in value;

  const handleItemClick = (item: ResourceTimeStat) => {
    if (item.isDirect) return;
    onNavigate(item.resourceId);
  };

  const handlePieClick = (entry: unknown) => {
    const item = isResourceTimeStat(entry)
      ? entry
      : typeof entry === "object" &&
          entry !== null &&
          "payload" in entry &&
          isResourceTimeStat(entry.payload)
        ? entry.payload
        : null;

    if (item) handleItemClick(item);
  };

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
      <div className="mb-2 flex min-h-7 items-center gap-2">
        {canGoBack && (
          <button
            type="button"
            onClick={() => onNavigate(ancestors[ancestors.length - 1]?.id ?? null)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-neutral-700 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            title="Wstecz"
            aria-label="Wstecz"
          >
            <ChevronLeft size={15} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-neutral-400">
            {title}
          </h3>
          {current && (
            <div className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-neutral-500">
              <button
                type="button"
                onClick={() => onNavigate(null)}
                className="shrink-0 hover:text-neutral-200"
              >
                Projekty
              </button>
              {[...ancestors, current].map((resource) => (
                <span key={resource.id} className="flex min-w-0 items-center gap-1">
                  <span>/</span>
                  <button
                    type="button"
                    onClick={() => onNavigate(resource.id)}
                    className="truncate hover:text-neutral-200"
                  >
                    {resource.name}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-neutral-500">
          Brak danych
        </div>
      ) : (
        <>
          <ResponsiveContainer
            width="100%"
            height={240}
            className="[&_.recharts-sector:focus]:outline-none [&_.recharts-surface:focus]:outline-none [&_.recharts-wrapper:focus]:outline-none"
          >
            <PieChart>
              <Pie
                data={data}
                dataKey="minutes"
                nameKey="name"
                innerRadius={50}
                outerRadius={90}
                paddingAngle={2}
                stroke="none"
                onClick={handlePieClick}
                className="cursor-pointer"
              >
                {data.map((d) => (
                  <Cell
                    key={d.id}
                    fill={d.color}
                    className={d.isDirect ? "cursor-default" : "cursor-pointer"}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0a0a0a",
                  border: "1px solid #404040",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                formatter={(value, _name, props) => {
                  const d = props.payload as ResourceTimeStat | undefined;
                  const typeLabel = d ? typeLabels[d.resourceType] ?? d.resourceType : "";
                  const label = d ? `${d.name}${typeLabel ? ` (${typeLabel})` : ""}` : String(_name);
                  return [formatMinutes(Number(value)), label];
                }}
              />
            </PieChart>
          </ResponsiveContainer>

          <ul className="mt-2 space-y-1 text-xs">
            {data.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => handleItemClick(d)}
                  disabled={d.isDirect}
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left disabled:cursor-default enabled:hover:bg-neutral-800"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: d.color }}
                  />
                  <span className="flex-1 truncate text-neutral-300">{d.name}</span>
                  <span className="tabular-nums text-neutral-400">{formatMinutes(d.minutes)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
