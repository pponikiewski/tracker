import { useEffect, useState } from "react";
import { COLOR_PRESETS } from "./colorPresets";

interface CreateResourceInput {
  name: string;
  color: string | null;
}

interface Props {
  title: string;
  placeholder?: string;
  confirmLabel?: string;
  initialColor: string;
  presets?: string[];
  onConfirm: (input: CreateResourceInput) => void;
  onCancel: () => void;
}

export function CreateResourceModal({
  title,
  placeholder,
  confirmLabel = "Utworz",
  initialColor,
  presets = COLOR_PRESETS,
  onConfirm,
  onCancel,
}: Props) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(initialColor);
  const [customColor, setCustomColor] = useState(initialColor);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const setExplicitColor = (value: string) => {
    setCustomColor(value);
    setColor(value);
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm({ name: trimmed, color });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="w-96 max-w-[calc(100vw-2rem)] rounded-md border border-neutral-700 bg-neutral-900 p-4 shadow-2xl">
        <h2 className="mb-3 text-sm font-semibold text-neutral-200">{title}</h2>

        <input
          type="text"
          autoFocus
          value={name}
          placeholder={placeholder}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          className="mb-3 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
        />

        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-neutral-400">Kolor</span>
          <span
            className="h-5 w-5 rounded border border-neutral-700"
            style={{ backgroundColor: color }}
          />
        </div>

        <div className="mb-3 grid grid-cols-8 gap-2">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setExplicitColor(preset)}
              className={`h-7 w-7 rounded-md border-2 transition-transform hover:scale-110 ${
                color === preset ? "border-white" : "border-transparent"
              }`}
              style={{ backgroundColor: preset }}
              aria-label={preset}
            />
          ))}
        </div>

        <div className="mb-4 flex items-center gap-2">
          <input
            type="color"
            value={customColor}
            onChange={(e) => setExplicitColor(e.target.value)}
            className="h-8 w-12 cursor-pointer rounded border border-neutral-700 bg-neutral-950"
            aria-label="Kolor niestandardowy"
          />
          <input
            type="text"
            value={customColor}
            onChange={(e) => setExplicitColor(e.target.value)}
            className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-blue-500"
            aria-label="Kod koloru"
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
            onClick={submit}
            disabled={!name.trim()}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500 disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
