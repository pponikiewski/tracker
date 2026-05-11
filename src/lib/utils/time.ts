/**
 * Time parser: accepts "1.5h", "90m", "1h 30m", "1:30", or raw minutes.
 * Returns INTEGER minutes or null if invalid.
 *
 * Examples:
 *   "1.5h" → 90
 *   "90m"  → 90
 *   "1h30m" → 90
 *   "1:30" → 90
 *   "45"   → 45 (raw minutes)
 */
export function parseTime(input: string): number | null {
  const trimmed = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!trimmed) return null;

  // "1:30" form
  const colon = /^(\d+):([0-5]?\d)$/.exec(trimmed);
  if (colon) {
    const h = Number(colon[1]);
    const m = Number(colon[2]);
    return h * 60 + m;
  }

  // Combined "1h30m"
  const combined = /^(\d+(?:\.\d+)?)h(\d+)m$/.exec(trimmed);
  if (combined) {
    const h = Number(combined[1]);
    const m = Number(combined[2]);
    return Math.round(h * 60) + m;
  }

  // Pure hours: "1.5h"
  const hours = /^(\d+(?:\.\d+)?)h$/.exec(trimmed);
  if (hours) {
    return Math.round(Number(hours[1]) * 60);
  }

  // Pure minutes: "90m"
  const mins = /^(\d+)m$/.exec(trimmed);
  if (mins) {
    return Number(mins[1]);
  }

  // Bare integer = minutes
  const bare = /^(\d+)$/.exec(trimmed);
  if (bare) {
    return Number(bare[1]);
  }

  return null;
}

/**
 * Format INTEGER minutes back to "Xh Ym" or "Ym" or "Xh".
 */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Today as ISO YYYY-MM-DD (local time). */
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
