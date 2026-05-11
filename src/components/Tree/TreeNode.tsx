import type { ResourceNode } from "@/lib/db/types";
import { formatMinutes } from "@/lib/utils/time";

interface Props {
  node: ResourceNode;
  depth: number;
  expanded: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onLogWork: (id: string) => void;
  expandedIds: Set<string>;
  selectedId: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  project: "PRJ",
  stage: "ETP",
  substage: "PDE",
  task: "ZAD",
};

export function TreeNode(props: Props) {
  const { node, depth, expanded, selected, onToggle, onSelect, onContextMenu, onLogWork } = props;
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        onClick={() => onSelect(node.id)}
        onContextMenu={(e) => onContextMenu(e, node.id)}
        className={`group flex cursor-default items-center gap-1 py-1 pr-2 text-sm transition-colors ${
          selected ? "bg-blue-900/40" : "hover:bg-neutral-800/60"
        }`}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggle(node.id);
          }}
          className={`flex h-4 w-4 items-center justify-center text-neutral-500 ${
            hasChildren ? "hover:text-neutral-200" : "invisible"
          }`}
        >
          <span
            className="inline-block transition-transform"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            ▶
          </span>
        </button>

        <span
          className="h-3 w-3 shrink-0 rounded-sm"
          style={{ backgroundColor: node.effective_color }}
          aria-hidden
        />

        <span className="w-9 shrink-0 text-[10px] font-mono uppercase tracking-wide text-neutral-500">
          {TYPE_LABEL[node.type]}
        </span>

        <span className="flex-1 truncate text-neutral-100">{node.name}</span>

        {node.cached_minutes > 0 && (
          <span className="ml-2 shrink-0 text-xs tabular-nums text-neutral-400">
            {formatMinutes(node.cached_minutes)}
          </span>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onLogWork(node.id);
          }}
          title="Loguj czas"
          className="ml-2 shrink-0 rounded p-1 text-neutral-500 opacity-0 transition-opacity hover:bg-neutral-700 hover:text-emerald-400 group-hover:opacity-100"
        >
          ▶
        </button>
      </div>

      {expanded &&
        node.children.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            depth={depth + 1}
            expanded={props.expandedIds.has(child.id)}
            selected={props.selectedId === child.id}
            onToggle={onToggle}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
            onLogWork={onLogWork}
            expandedIds={props.expandedIds}
            selectedId={props.selectedId}
          />
        ))}
    </>
  );
}
