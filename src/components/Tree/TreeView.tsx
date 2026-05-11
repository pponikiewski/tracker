import type { ResourceNode } from "@/lib/db/types";
import { TreeNode } from "./TreeNode";

interface Props {
  tree: ResourceNode[];
  expandedIds: Set<string>;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onContextMenuNode: (e: React.MouseEvent, id: string) => void;
  onContextMenuEmpty: (e: React.MouseEvent) => void;
  onLogWork: (id: string) => void;
}

export function TreeView({
  tree,
  expandedIds,
  selectedId,
  onToggle,
  onSelect,
  onContextMenuNode,
  onContextMenuEmpty,
  onLogWork,
}: Props) {
  return (
    <div
      onContextMenu={(e) => {
        // Only fires if no child stopped propagation.
        e.preventDefault();
        onContextMenuEmpty(e);
      }}
      className="min-h-full select-none"
    >
      {tree.length === 0 && (
        <div className="px-4 py-12 text-center text-sm text-neutral-500">
          Pusty obszar. Prawy klik → <span className="text-neutral-300">Nowy Projekt</span>.
        </div>
      )}
      {tree.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          expanded={expandedIds.has(node.id)}
          selected={selectedId === node.id}
          onToggle={onToggle}
          onSelect={onSelect}
          onContextMenu={(e, id) => {
            e.preventDefault();
            e.stopPropagation();
            onContextMenuNode(e, id);
          }}
          onLogWork={onLogWork}
          expandedIds={expandedIds}
          selectedId={selectedId}
        />
      ))}
    </div>
  );
}
