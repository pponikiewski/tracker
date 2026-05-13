import { useEffect, useRef, useState } from "react";
import { AssignmentPicker } from "@/components/Assignments/AssignmentPicker";

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

/**
 * A special menu entry that opens the AssignmentPicker popover when clicked.
 * Requirements: 5.10
 */
export interface AssignMenuItem {
  label: string;
  assignAction: true;
  resourceId: string;
  workspaceId: string;
  danger?: never;
  separator?: never;
  disabled?: boolean;
}

export type MenuEntry = MenuItem | MenuSeparator | AssignMenuItem;

interface Props {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pickerEntry, setPickerEntry] = useState<AssignMenuItem | null>(null);

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
    <>
      <div
        ref={ref}
        className="fixed z-50 min-w-[220px] rounded-md border border-neutral-700 bg-neutral-900 py-1 text-sm shadow-2xl"
        style={{ left: x, top: y }}
      >
        {items.map((item, i) => {
          if ("separator" in item) {
            return <div key={i} className="my-1 h-px bg-neutral-700" />;
          }
          if ("assignAction" in item) {
            return (
              <button
                key={i}
                type="button"
                disabled={item.disabled}
                onClick={() => setPickerEntry(item)}
                className="block w-full px-3 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 text-neutral-200 hover:bg-neutral-800"
              >
                {item.label}
              </button>
            );
          }
          return (
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
          );
        })}
      </div>

      {pickerEntry && (
        <AssignmentPicker
          resourceId={pickerEntry.resourceId}
          workspaceId={pickerEntry.workspaceId}
          anchorX={x}
          anchorY={y}
          onClose={() => {
            setPickerEntry(null);
            onClose();
          }}
        />
      )}
    </>
  );
}
