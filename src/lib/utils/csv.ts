import { invoke, isTauri } from "@tauri-apps/api/core";
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

function escapeMarkdownCell(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function browserDownload(
  filename: string,
  content: string,
  type: string,
  includeBom: boolean,
): void {
  const parts: BlobPart[] = includeBom ? ["\ufeff", content] : [content];
  const blob = new Blob(parts, { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function canUseTauriInvoke(): boolean {
  return isTauri() || "__TAURI_INTERNALS__" in window;
}

async function exportTextFile(
  filename: string,
  content: string,
  type: string,
  includeBom = false,
): Promise<string | null> {
  if (canUseTauriInvoke()) {
    return invoke<string>("export_text_file", {
      input: { filename, content, includeBom },
    });
  }

  browserDownload(filename, content, type, includeBom);
  return null;
}

export function downloadText(filename: string, content: string): Promise<string | null> {
  return exportTextFile(filename, content, "text/plain;charset=utf-8");
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

export function eventsToMarkdown(
  events: EventWithResource[],
  range: { from: string; to: string },
): string {
  const totalMinutes = events.reduce((sum, event) => sum + event.minutes, 0);
  const lines = [
    `# Tracker report: ${range.from} to ${range.to}`,
    "",
    `Total: ${totalMinutes} min (${(totalMinutes / 60).toFixed(2)} h)`,
    "",
    "| Date | Resource | Minutes | Hours | Goal | Topics | Notes | Report |",
    "| --- | --- | ---: | ---: | --- | --- | --- | --- |",
  ];

  for (const event of events) {
    const cells = [
      event.date,
      escapeMarkdownCell(event.resource_name),
      String(event.minutes),
      (event.minutes / 60).toFixed(2),
      escapeMarkdownCell(event.goal),
      escapeMarkdownCell(event.topics),
      escapeMarkdownCell(event.notes),
      escapeMarkdownCell(event.report),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }

  return lines.join("\n");
}

export function downloadCsv(filename: string, content: string): Promise<string | null> {
  return exportTextFile(filename, content, "text/csv;charset=utf-8", true);
}
