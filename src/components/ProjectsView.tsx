import { useEffect, useMemo, useState } from "react";
import { useProjects } from "@/store/projects";
import { useWorkspaceStore } from "@/store/workspace";
import { useAssignmentStore } from "@/store/assignments";
import { useProfileStore } from "@/store/profile";
import { useAuthStore } from "@/store/auth";
import { TreeView } from "./Tree/TreeView";
import { ContextMenu, type MenuEntry } from "./ContextMenu";
import { PromptModal } from "./PromptModal";
import { ColorPickerModal } from "./ColorPickerModal";
import { LogWorkModal } from "./LogWorkModal";
import { canParent, defaultChildType, type Resource, type ResourceNode, type ResourceType } from "@/lib/db/types";
import { isDescendantPath } from "@/lib/utils/tree";

const TYPE_LABEL: Record<ResourceType, string> = {
  project: "Projekt",
  stage: "Etap",
  substage: "Podetap",
  task: "Zadanie",
};

/** Filter value: 'all' = no filter, 'me' = assigned to current user, or a specific user_id */
type AssignmentFilter = "all" | "me" | string;

interface MenuState {
  x: number;
  y: number;
  targetId: string | null;
}

interface PromptState {
  title: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
}

const isEditableTarget = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
};

/**
 * Collect all node IDs in the subtree rooted at `node` that have the given userId as an assignee.
 * Returns a set of matching resource IDs.
 */
function collectMatchingIds(
  node: ResourceNode,
  userId: string,
  assignmentsByResource: Record<string, string[]>,
): Set<string> {
  const result = new Set<string>();
  const assignees = assignmentsByResource[node.id] ?? [];
  if (assignees.includes(userId)) {
    result.add(node.id);
  }
  for (const child of node.children) {
    for (const id of collectMatchingIds(child, userId, assignmentsByResource)) {
      result.add(id);
    }
  }
  return result;
}

/**
 * Given a tree and a set of directly-matched IDs, compute:
 * - `visibleIds`: IDs that should be shown (matched + ancestors)
 * - `dimmedIds`: ancestor IDs that should be shown at reduced opacity
 *
 * Returns null if the filter is 'all' (no filtering needed).
 */
function computeFilteredSets(
  tree: ResourceNode[],
  matchedIds: Set<string>,
): { visibleIds: Set<string>; dimmedIds: Set<string> } {
  const visibleIds = new Set<string>();
  const dimmedIds = new Set<string>();

  function walk(node: ResourceNode): boolean {
    const isMatch = matchedIds.has(node.id);
    let childMatched = false;
    for (const child of node.children) {
      if (walk(child)) childMatched = true;
    }
    if (isMatch || childMatched) {
      visibleIds.add(node.id);
      if (!isMatch && childMatched) {
        // Ancestor node — show at reduced opacity
        dimmedIds.add(node.id);
      }
      return true;
    }
    return false;
  }

  for (const node of tree) {
    walk(node);
  }

  return { visibleIds, dimmedIds };
}

/**
 * Filter a tree to only include nodes whose IDs are in `visibleIds`.
 * Preserves tree structure (ancestors are kept even if not directly matched).
 */
function filterTree(nodes: ResourceNode[], visibleIds: Set<string>): ResourceNode[] {
  const result: ResourceNode[] = [];
  for (const node of nodes) {
    if (!visibleIds.has(node.id)) continue;
    const filteredChildren = filterTree(node.children, visibleIds);
    result.push({ ...node, children: filteredChildren });
  }
  return result;
}

export function ProjectsView() {
  const {
    resources,
    tree,
    expandedIds,
    loading,
    error,
    refresh,
    toggleExpanded,
    addProject,
    addChild,
    rename,
    move,
    changeColor,
    deleteSubtree,
    liftAndDelete,
    detachAsProjects,
    logTime,
  } = useProjects();

  const allWorkspaces = useWorkspaceStore((s) => s.workspaces);
  const memberships = useWorkspaceStore((s) => s.memberships);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeWorkspace = allWorkspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const assignmentsByResource = useAssignmentStore((s) => s.assignmentsByResource);
  const getProfile = useProfileStore((s) => s.getProfile);
  const authState = useAuthStore((s) => s.state);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [colorTargetId, setColorTargetId] = useState<string | null>(null);
  const [logWorkResource, setLogWorkResource] = useState<Resource | null>(null);

  // Assignment filter state — reset to 'all' on workspace change
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>("all");

  // Detect Local_Personal_Workspace (owner_id === 'local')
  const isLocalWorkspace = activeWorkspace?.owner_id === "local";

  // Reset filter when workspace changes
  useEffect(() => {
    setAssignmentFilter("all");
  }, [activeWorkspaceId]);

  // Resolve the effective user ID for the current filter
  const currentUserId = authState.kind === "authed" ? authState.user.id : null;
  const effectiveFilterUserId = useMemo((): string | null => {
    if (assignmentFilter === "all") return null;
    if (assignmentFilter === "me") return currentUserId;
    return assignmentFilter;
  }, [assignmentFilter, currentUserId]);

  // Compute filtered tree and dimmed IDs
  const { filteredTree, dimmedIds, hasMatches } = useMemo(() => {
    if (effectiveFilterUserId === null) {
      return { filteredTree: tree, dimmedIds: new Set<string>(), hasMatches: true };
    }
    const matchedIds = new Set<string>();
    for (const node of tree) {
      for (const id of collectMatchingIds(node, effectiveFilterUserId, assignmentsByResource)) {
        matchedIds.add(id);
      }
    }
    if (matchedIds.size === 0) {
      return { filteredTree: [], dimmedIds: new Set<string>(), hasMatches: false };
    }
    const { visibleIds, dimmedIds: dIds } = computeFilteredSets(tree, matchedIds);
    const ft = filterTree(tree, visibleIds);
    return { filteredTree: ft, dimmedIds: dIds, hasMatches: true };
  }, [tree, effectiveFilterUserId, assignmentsByResource]);

  // Build member list for the filter dropdown (workspace members excluding current user for "me" option)
  const workspaceMembers = useMemo(() => {
    return memberships.map((m) => ({
      userId: m.user_id,
      displayName: getProfile(m.user_id).display_name,
    }));
  }, [memberships, getProfile]);

  // Label for the empty-state message
  const emptyStateLabel = useMemo(() => {
    if (assignmentFilter === "me") return "Assigned to me";
    if (assignmentFilter !== "all") {
      const member = workspaceMembers.find((m) => m.userId === assignmentFilter);
      return member ? member.displayName : assignmentFilter;
    }
    return "";
  }, [assignmentFilter, workspaceMembers]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Block native context menu globally on this view.
  useEffect(() => {
    const onCtx = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", onCtx);
    return () => document.removeEventListener("contextmenu", onCtx);
  }, []);

  const findResource = (id: string): Resource | undefined =>
    resources.find((r) => r.id === id);

  const handleContextEmpty = (e: React.MouseEvent) => {
    setMenu({ x: e.clientX, y: e.clientY, targetId: null });
  };

  const handleContextNode = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(id);
    setMenu({ x: e.clientX, y: e.clientY, targetId: id });
  };

  const openNewProjectPrompt = () => {
    setPrompt({
      title: "Nowy Projekt",
      placeholder: "Nazwa projektu",
      onConfirm: async (name) => {
        await addProject(name);
        setPrompt(null);
      },
    });
  };

  const openAddChildPrompt = (parentId: string, type: ResourceType) => {
    setPrompt({
      title: `Dodaj ${TYPE_LABEL[type]}`,
      placeholder: `Nazwa: ${TYPE_LABEL[type].toLowerCase()}`,
      onConfirm: async (name) => {
        await addChild(parentId, name, type);
        setPrompt(null);
      },
    });
  };

  // ---- Drag-drop ----

  const canDropOn = (sourceId: string, targetId: string | null): boolean => {
    const source = findResource(sourceId);
    if (!source) return false;
    if (targetId === null) {
      // Dropping at root area = make project.
      return source.type !== "project" || source.parent_id !== null;
    }
    if (sourceId === targetId) return false;
    const target = findResource(targetId);
    if (!target) return false;
    if (isDescendantPath(source.path, target.path)) return false;
    return canParent(target.type, source.type);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    if (!draggingId) return;
    if (canDropOn(draggingId, id)) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      if (dropTargetId !== id) setDropTargetId(id);
    } else {
      e.dataTransfer.dropEffect = "none";
    }
  };

  const handleDrop = async (e: React.DragEvent, id: string) => {
    if (!draggingId) return;
    e.preventDefault();
    e.stopPropagation();
    const src = draggingId;
    setDraggingId(null);
    setDropTargetId(null);
    if (!canDropOn(src, id)) return;
    try {
      await move(src, id);
    } catch {
      /* validation error — silently ignore for MVP */
    }
  };

  const handleDragOverEmpty = (e: React.DragEvent) => {
    if (!draggingId) return;
    if (canDropOn(draggingId, null)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  };

  const handleDropEmpty = async (e: React.DragEvent) => {
    if (!draggingId) return;
    e.preventDefault();
    const src = draggingId;
    setDraggingId(null);
    setDropTargetId(null);
    if (!canDropOn(src, null)) return;
    try {
      await move(src, null);
    } catch {
      /* */
    }
  };

  // ---- Keyboard shortcuts ----

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      // Ctrl+N → new project
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        openNewProjectPrompt();
        return;
      }
      // Esc → clear selection / close rename
      if (e.key === "Escape") {
        setRenamingId(null);
        setMenu(null);
        return;
      }
      if (!selectedId) return;
      // F2 or Enter → rename selected
      if (e.key === "F2" || (e.key === "Enter" && !mod)) {
        e.preventDefault();
        setRenamingId(selectedId);
        return;
      }
      // Delete → soft delete subtree
      if (e.key === "Delete" || (mod && e.key === "Backspace")) {
        e.preventDefault();
        void deleteSubtree(selectedId);
        setSelectedId(null);
        return;
      }
      // L → log work
      if (!mod && e.key.toLowerCase() === "l") {
        const r = findResource(selectedId);
        if (r) {
          e.preventDefault();
          setLogWorkResource(r);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, resources]);

  // ---- Menu items ----

  const buildMenuItems = (targetId: string | null): MenuEntry[] => {
    if (targetId === null) {
      return [{ label: "Nowy Projekt", onClick: openNewProjectPrompt }];
    }
    const node = findResource(targetId);
    if (!node) return [];

    const items: MenuEntry[] = [];
    items.push({
      label: "Loguj czas... (L)",
      onClick: () => setLogWorkResource(node),
    });
    items.push({
      label: "Zmień nazwę (F2)",
      onClick: () => setRenamingId(node.id),
    });
    items.push({ separator: true });

    items.push({
      label: "Zmień kolor...",
      onClick: () => setColorTargetId(node.id),
    });
    if (node.color !== null) {
      items.push({
        label: "Wyczyść kolor (dziedzicz)",
        onClick: () => void changeColor(node.id, null),
      });
    }

    const childType = defaultChildType(node.type);
    if (childType) {
      items.push({ separator: true });
      items.push({
        label: `Dodaj ${TYPE_LABEL[childType]}`,
        onClick: () => openAddChildPrompt(node.id, childType),
      });
      if (childType !== "task" && (node.type === "project" || node.type === "stage")) {
        items.push({
          label: "Dodaj Zadanie (skrót)",
          onClick: () => openAddChildPrompt(node.id, "task"),
        });
      }
    }

    items.push({ separator: true });

    if (node.type === "project") {
      items.push({
        label: "Zostaw podległe jako projekty",
        onClick: () => void detachAsProjects(node.id),
      });
    } else {
      items.push({
        label: "Usuń, przypisz podległe wyżej",
        onClick: () => void liftAndDelete(node.id),
      });
    }
    items.push({
      label: "Usuń wraz z podległymi (Delete)",
      danger: true,
      onClick: () => void deleteSubtree(node.id),
    });

    return items;
  };

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <span className="text-xs uppercase tracking-wide text-neutral-500">
          Drzewo projektów
          <span className="ml-3 normal-case text-neutral-600">
            Ctrl+N nowy · F2 zmień nazwę · L log · Delete usuń · Drag-drop
          </span>
        </span>
        <span className="text-xs text-neutral-500">
          {loading ? "Ładowanie..." : `${resources.length} węzłów`}
        </span>
      </header>

      {error && (
        <div className="border-b border-red-900 bg-red-950 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Assignment filter bar — hidden for Local_Personal_Workspace */}
      {!isLocalWorkspace && (
        <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-1.5">
          <span className="text-xs text-neutral-500">Filtr:</span>
          <select
            value={assignmentFilter}
            onChange={(e) => setAssignmentFilter(e.target.value as AssignmentFilter)}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-xs text-neutral-200 focus:border-blue-500 focus:outline-none"
            aria-label="Filtr przypisania"
          >
            <option value="all">Wszyscy członkowie</option>
            <option value="me">Przypisane do mnie</option>
            {workspaceMembers
              .filter((m) => m.userId !== currentUserId)
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
          </select>
        </div>
      )}

      <main className="flex-1 overflow-auto">
        {!hasMatches ? (
          <div className="px-4 py-12 text-center text-sm text-neutral-500">
            Brak zasobów przypisanych do{" "}
            <span className="text-neutral-300">{emptyStateLabel}</span>.
          </div>
        ) : (
          <TreeView
            tree={filteredTree}
            expandedIds={expandedIds}
            selectedId={selectedId}
            renamingId={renamingId}
            draggingId={draggingId}
            dropTargetId={dropTargetId}
            dimmedIds={dimmedIds}
            onToggle={toggleExpanded}
            onSelect={setSelectedId}
            onContextMenu={handleContextNode}
            onContextMenuEmpty={handleContextEmpty}
            onDragOverEmpty={handleDragOverEmpty}
            onDropEmpty={handleDropEmpty}
            onLogWork={(id) => {
              const r = findResource(id);
              if (r) setLogWorkResource(r);
            }}
            onStartRename={setRenamingId}
            onCommitRename={async (id, name) => {
              await rename(id, name);
              setRenamingId(null);
            }}
            onCancelRename={() => setRenamingId(null)}
            onDragStart={(id) => setDraggingId(id)}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={() => {
              setDraggingId(null);
              setDropTargetId(null);
            }}
          />
        )}
      </main>

      <footer className="border-t border-neutral-800 px-4 py-1.5 text-[10px] text-neutral-500">
        Faza 3 · Polish UX
      </footer>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenuItems(menu.targetId)}
          onClose={() => setMenu(null)}
        />
      )}

      {prompt && (
        <PromptModal
          title={prompt.title}
          placeholder={prompt.placeholder}
          confirmLabel="Utwórz"
          onConfirm={prompt.onConfirm}
          onCancel={() => setPrompt(null)}
        />
      )}

      {colorTargetId && (
        <ColorPickerModal
          initial={findResource(colorTargetId)?.color ?? null}
          onConfirm={async (color) => {
            await changeColor(colorTargetId, color);
            setColorTargetId(null);
          }}
          onCancel={() => setColorTargetId(null)}
        />
      )}

      {logWorkResource && (
        <LogWorkModal
          resource={logWorkResource}
          onSubmit={async (input) => {
            await logTime({ resourceId: logWorkResource.id, ...input });
            setLogWorkResource(null);
          }}
          onCancel={() => setLogWorkResource(null)}
        />
      )}
    </div>
  );
}
