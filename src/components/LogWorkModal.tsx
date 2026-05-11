import { useEffect, useState } from "react";
import type { Resource } from "@/lib/db/types";
import { parseTime, todayIso } from "@/lib/utils/time";

interface Props {
  resource: Resource;
  onSubmit: (input: {
    date: string;
    minutes: number;
    goal?: string;
    topics?: string;
    notes?: string;
    report?: string;
  }) => void | Promise<void>;
  onCancel: () => void;
}

export function LogWorkModal({ resource, onSubmit, onCancel }: Props) {
  const [date, setDate] = useState(todayIso());
  const [timeInput, setTimeInput] = useState("");
  const [goal, setGoal] = useState("");
  const [topics, setTopics] = useState("");
  const [notes, setNotes] = useState("");
  const [report, setReport] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const minutes = parseTime(timeInput);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = async () => {
    if (minutes === null || minutes <= 0 || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        date,
        minutes,
        goal: goal.trim() || undefined,
        topics: topics.trim() || undefined,
        notes: notes.trim() || undefined,
        report: report.trim() || undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="w-[28rem] rounded-md border border-neutral-700 bg-neutral-900 p-4 shadow-2xl">
        <h2 className="mb-1 text-sm font-semibold text-neutral-200">Loguj czas</h2>
        <p className="mb-3 truncate text-xs text-neutral-500">{resource.name}</p>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="text-xs text-neutral-400">
            Data
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
            />
          </label>
          <label className="text-xs text-neutral-400">
            Czas <span className="text-neutral-600">(np. 1.5h, 90m, 1:30)</span>
            <input
              type="text"
              autoFocus
              value={timeInput}
              onChange={(e) => setTimeInput(e.target.value)}
              placeholder="1.5h"
              className={`mt-1 w-full rounded border bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none ${
                timeInput && minutes === null
                  ? "border-red-700 focus:border-red-500"
                  : "border-neutral-700 focus:border-blue-500"
              }`}
            />
            {timeInput && minutes !== null && (
              <span className="mt-1 text-xs text-emerald-500">= {minutes} min</span>
            )}
          </label>
        </div>

        <label className="mb-2 block text-xs text-neutral-400">
          Cel
          <input
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
          />
        </label>

        <label className="mb-2 block text-xs text-neutral-400">
          Tematy
          <input
            type="text"
            value={topics}
            onChange={(e) => setTopics(e.target.value)}
            className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
          />
        </label>

        <label className="mb-2 block text-xs text-neutral-400">
          Notatki
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full resize-y rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
          />
        </label>

        <label className="mb-3 block text-xs text-neutral-400">
          Raport
          <textarea
            rows={3}
            value={report}
            onChange={(e) => setReport(e.target.value)}
            className="mt-1 w-full resize-y rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={minutes === null || minutes <= 0 || submitting}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500 disabled:opacity-40"
          >
            {submitting ? "Zapis..." : "Zapisz"}
          </button>
        </div>
      </div>
    </div>
  );
}
