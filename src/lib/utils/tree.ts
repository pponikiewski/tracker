import type { Resource, ResourceNode } from "../db/types";

const DEFAULT_COLOR = "#6b7280";

/**
 * Build path string for a node given its ancestors.
 * Path format: "id1/id2/id3" — root first, self last.
 */
export function buildPath(ancestors: string[], selfId: string): string {
  return [...ancestors, selfId].join("/");
}

/** Returns parent path segment, or null for root nodes. */
export function parentPath(path: string): string | null {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? null : path.slice(0, idx);
}

/** Returns ancestor ids as a list (root first, parent last). */
export function ancestorIds(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1);
}

/** True if `descendant` is in the subtree rooted at `ancestor`. */
export function isDescendantPath(ancestor: string, descendant: string): boolean {
  return descendant === ancestor || descendant.startsWith(`${ancestor}/`);
}

/**
 * Build a tree from a flat list of Resources sorted by path.
 * Resolves effective_color by walking ancestors in the same flat list.
 */
export function buildTree(resources: Resource[]): ResourceNode[] {
  const byId = new Map<string, ResourceNode>();
  for (const r of resources) {
    byId.set(r.id, {
      ...r,
      children: [],
      effective_color: r.color ?? DEFAULT_COLOR,
    });
  }

  // Resolve effective_color: COALESCE up ancestors via path.
  for (const node of byId.values()) {
    if (node.color) continue;
    const ancestors = ancestorIds(node.path);
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const ancId = ancestors[i];
      if (!ancId) continue;
      const anc = byId.get(ancId);
      if (anc?.color) {
        node.effective_color = anc.color;
        break;
      }
    }
  }

  const roots: ResourceNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_id === null) {
      roots.push(node);
    } else {
      const parent = byId.get(node.parent_id);
      if (parent) parent.children.push(node);
    }
  }

  // Sort each level alphabetically, like folders in a file tree.
  const sortRecursive = (nodes: ResourceNode[]) => {
    nodes.sort(
      (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
        a.created_at - b.created_at,
    );
    nodes.forEach((n) => sortRecursive(n.children));
  };
  sortRecursive(roots);

  return roots;
}
