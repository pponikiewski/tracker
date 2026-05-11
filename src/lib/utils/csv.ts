import type { EventWithResource } from "@/lib/db/queries";

const HEADER = [
  "date",
  "minutes",
  "hours",
  "resource_name",
  "resource_path",
  "goal",
  "topics",
  "notes",
  "report",
];

function escapeCsv(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const needsQuote = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

export function eventsToCsv(events: EventWithResource[]): string {
  const lines = [HEADER.join(",")];
  for (const e of events) {
    lines.push(
      [
        e.date,
        String(e.minutes),
        (e.minutes / 60).toFixed(2),
        escapeCsv(e.resource_name),
        escapeCsv(e.resource_path),
        escapeCsv(e.goal),
        escapeCsv(e.topics),
        escapeCsv(e.notes),
        escapeCsv(e.report),
      ].join(","),
    );
  }
  return lines.join("\n");
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
