import type { ResourceNode } from "@/lib/db/types";
import { TreeNode, type TreeContext } from "./TreeNode";

interface Props extends TreeContext {
  tree: ResourceNode[];
  onContextMenuEmpty: (e: React.MouseEvent) => void;
  onDropEmpty: (e: React.DragEvent) => void;
  onDragOverEmpty: (e: React.DragEvent) => void;
}

export function TreeView(props: Props) {
  const { tree, onContextMenuEmpty, onDropEmpty, onDragOverEmpty, ...ctx } = props;
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenuEmpty(e);
      }}
      onDragOver={(e) => onDragOverEmpty(e)}
      onDrop={(e) => onDropEmpty(e)}
      className="min-h-full select-none"
    >
      {tree.length === 0 && (
        <div className="px-4 py-12 text-center text-sm text-neutral-500">
          Pusty obszar. Prawy klik → <span className="text-neutral-300">Nowy Projekt</span>.
        </div>
      )}
      {tree.map((node) => (
        <TreeNode key={node.id} {...ctx} node={node} depth={0} />
      ))}
    </div>
  );
}
