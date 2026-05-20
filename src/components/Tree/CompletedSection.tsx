import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ResourceNode } from "@/lib/db/types";
import { formatMinutes } from "@/lib/utils/time";

interface Props {
  tree: ResourceNode[];
  onUnomplete: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
}

function CompletedNode({
  node,
  depth,
  onUnomplete,
  onContextMenu,
}: {
  node: ResourceNode;
  depth: number;
  onUnomplete: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        className="group flex cursor-default items-center gap-1 py-1 pr-2 text-sm text-neutral-500 hover:bg-neutral-800/40 hover:text-neutral-400"
        style={{ paddingLeft: 8 + depth * 16 }}
        onContextMenu={(e) => onContextMenu(e, node.id)}
      >
        <span
          className={`flex h-4 w-4 items-center justify-center ${hasChildren ? "cursor-pointer" : "invisible"}`}
          aria-hidden="true"
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronRight
            size={11}
            className={`transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </span>

        <span className="flex-1 truncate line-through opacity-60">{node.name}</span>

        {node.cached_minutes > 0 && (
          <span className="ml-2 shrink-0 text-xs tabular-nums opacity-50">
            {formatMinutes(node.cached_minutes)}
          </span>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUnomplete(node.id);
          }}
          title="Wznów"
          className="ml-2 shrink-0 rounded px-1.5 py-0.5 text-xs text-neutral-600 opacity-0 transition-opacity hover:bg-neutral-700 hover:text-neutral-300 group-hover:opacity-100"
        >
          Wznów
        </button>
      </div>

      {expanded &&
        node.children.map((child) => (
          <CompletedNode
            key={child.id}
            node={child}
            depth={depth + 1}
            onUnomplete={onUnomplete}
            onContextMenu={onContextMenu}
          />
        ))}
    </>
  );
}

export function CompletedSection({ tree, onUnomplete, onContextMenu }: Props) {
  const [open, setOpen] = useState(false);

  if (tree.length === 0) return null;

  return (
    <div className="mt-1 border-t border-neutral-800/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-neutral-600 transition-colors hover:text-neutral-400"
      >
        <ChevronRight
          size={11}
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span>Zakończone ({tree.length})</span>
      </button>

      {open && (
        <div>
          {tree.map((node) => (
            <CompletedNode
              key={node.id}
              node={node}
              depth={0}
              onUnomplete={onUnomplete}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}
