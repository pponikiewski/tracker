import { useEffect, useRef } from "react";

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  separator?: never;
  disabled?: boolean;
}

export interface MenuSeparator {
  separator: true;
}

export type MenuEntry = MenuItem | MenuSeparator;

interface Props {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[220px] rounded-md border border-neutral-700 bg-neutral-900 py-1 text-sm shadow-2xl"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) =>
        "separator" in item ? (
          <div key={i} className="my-1 h-px bg-neutral-700" />
        ) : (
          <button
            key={i}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className={`block w-full px-3 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              item.danger
                ? "text-red-400 hover:bg-red-950 hover:text-red-300"
                : "text-neutral-200 hover:bg-neutral-800"
            }`}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
