import { useEffect, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function dateToIso(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function fmtShort(iso: string) {
  return isoToDate(iso).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "short",
  });
}

const pickerCls = {
  root: "select-none",
  months: "",
  month: "space-y-1",
  month_caption: "flex items-center justify-between px-1 mb-1",
  caption_label: "text-[11px] font-semibold text-neutral-100 capitalize",
  nav: "flex items-center gap-0.5",
  button_previous:
    "flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors text-[10px]",
  button_next:
    "flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors text-[10px]",
  month_grid: "w-full",
  weekdays: "",
  weekday: "pb-0.5 text-[9px] font-medium text-neutral-600 text-center w-6",
  week: "",
  day: "p-0 text-center",
  day_button:
    "mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[10px] text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white focus:outline-none",
  selected: "!bg-blue-600 !text-white hover:!bg-blue-500",
  today: "ring-1 ring-inset ring-blue-500 font-semibold text-blue-300",
  outside: "opacity-25 pointer-events-none",
  disabled: "opacity-20 cursor-not-allowed pointer-events-none",
  hidden: "invisible",
};

interface SingleDatePickerProps {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
}

function SingleDatePicker({ label, value, onChange, min, max }: SingleDatePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onOut = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onOut);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onOut);
    };
  }, [open]);

  const selected = isoToDate(value);
  const disabled: import("react-day-picker").Matcher[] = [];
  if (min) disabled.push({ before: isoToDate(min) });
  if (max) disabled.push({ after: isoToDate(max) });

  return (
    <div className="relative min-w-0 flex-1" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={[
          "flex w-full flex-col items-start rounded border px-2 py-1 transition-colors",
          open
            ? "border-blue-500 bg-neutral-900"
            : "border-neutral-700 bg-neutral-950 hover:border-neutral-500",
        ].join(" ")}
      >
        <span className="text-[10px] text-neutral-500">{label}</span>
        <span className="text-xs font-medium text-neutral-100">{fmtShort(value)}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 rounded-xl border border-neutral-700 bg-neutral-900 p-2 shadow-2xl">
          <DayPicker
            mode="single"
            selected={selected}
            defaultMonth={selected}
            disabled={disabled}
            onSelect={(d) => {
              if (d) { onChange(dateToIso(d)); setOpen(false); }
            }}
            classNames={pickerCls}
          />
        </div>
      )}
    </div>
  );
}

interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

export function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <SingleDatePicker
        label="Od"
        value={from}
        max={to}
        onChange={(f) => onChange(f, to)}
      />
      <span className="shrink-0 text-xs text-neutral-600">→</span>
      <SingleDatePicker
        label="Do"
        value={to}
        min={from}
        onChange={(t) => onChange(from, t)}
      />
    </div>
  );
}
