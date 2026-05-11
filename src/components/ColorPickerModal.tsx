import { useState } from "react";

const PRESETS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
];

interface Props {
  initial: string | null;
  onConfirm: (color: string) => void;
  onCancel: () => void;
}

export function ColorPickerModal({ initial, onConfirm, onCancel }: Props) {
  const [value, setValue] = useState(initial ?? "#3b82f6");

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="w-80 rounded-md border border-neutral-700 bg-neutral-900 p-4 shadow-2xl">
        <h2 className="mb-3 text-sm font-semibold text-neutral-200">Wybierz kolor</h2>

        <div className="mb-3 grid grid-cols-8 gap-2">
          {PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setValue(c)}
              className={`h-7 w-7 rounded-md border-2 transition-transform hover:scale-110 ${
                value === c ? "border-white" : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
              aria-label={c}
            />
          ))}
        </div>

        <div className="mb-3 flex items-center gap-2">
          <input
            type="color"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-8 w-12 cursor-pointer rounded border border-neutral-700 bg-neutral-950"
          />
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-blue-500"
          />
        </div>

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
            onClick={() => onConfirm(value)}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500"
          >
            Zapisz
          </button>
        </div>
      </div>
    </div>
  );
}
