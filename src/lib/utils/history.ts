import type { EventWithResource } from "@/lib/db/queries";

export interface DayGroup {
  date: string;
  label: string;
  events: EventWithResource[];
  totalMinutes: number;
}

export function isoMinusDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year as number, (month as number) - 1, day as number);
  date.setDate(date.getDate() - days);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function dayGroupLabel(dateIso: string, todayIso: string): string {
  if (dateIso === todayIso) return "Dzisiaj";
  if (dateIso === isoMinusDays(todayIso, 1)) return "Wczoraj";
  const [year, month, day] = dateIso.split("-");
  return `${day}.${month}.${year}`;
}

export function groupEventsByDate(events: EventWithResource[], todayIso: string): DayGroup[] {
  const byDate = new Map<string, EventWithResource[]>();
  for (const event of events) {
    const list = byDate.get(event.date) ?? [];
    list.push(event);
    byDate.set(event.date, list);
  }

  return [...byDate.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((date) => {
      const dateEvents = byDate.get(date) ?? [];
      return {
        date,
        label: dayGroupLabel(date, todayIso),
        events: dateEvents,
        totalMinutes: dateEvents.reduce((sum, event) => sum + event.minutes, 0),
      };
    });
}

export function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} ${hh}:${minutes}`;
}
