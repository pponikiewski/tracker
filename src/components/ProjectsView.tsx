import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjects } from "@/store/projects";
import { useWorkspaceStore } from "@/store/workspace";
import { useAssignmentStore } from "@/store/assignments";
import { useProfileStore } from "@/store/profile";
import { useAuthStore } from "@/store/auth";
import { usePresenceStore } from "@/store/presence";
import { useTreeUiStore } from "@/store/treeUi";
import { TreeView } from "./Tree/TreeView";
import { ContextMenu, type MenuEntry, type AssignMenuItem } from "./ContextMenu";
import { ColorPickerModal } from "./ColorPickerModal";
import { CreateResourceModal } from "./CreateResourceModal";
import { LogWorkModal } from "./LogWorkModal";
import {
  getColorPresetsForType,
  getDefaultChildColor,
  getDefaultColorForType,
} from "./colorPresets";
import {
  canParent,
  defaultChildType,
  type Resource,
  type ResourceNode,
  type ResourceType,
} from "@/lib/db/types";
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

interface CreateModalState {
  title: string;
  placeholder?: string;
  initialColor: string;
  presets: string[];
  onConfirm: (input: { name: string; color: string | null }) => void;
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
  const resources = useProjects((s) => s.resources);
  const tree = useProjects((s) => s.tree);
  const error = useProjects((s) => s.error);
  const refresh = useProjects((s) => s.refresh);
  const toggleExpanded = useProjects((s) => s.toggleExpanded);
  const addProject = useProjects((s) => s.addProject);
  const addChild = useProjects((s) => s.addChild);
  const rename = useProjects((s) => s.rename);
  const move = useProjects((s) => s.move);
  const changeColor = useProjects((s) => s.changeColor);
  const deleteSubtree = useProjects((s) => s.deleteSubtree);
  const liftAndDelete = useProjects((s) => s.liftAndDelete);
  const detachAsProjects = useProjects((s) => s.detachAsProjects);
  const logTime = useProjects((s) => s.logTime);

  const allWorkspaces = useWorkspaceStore((s) => s.workspaces);
  const memberships = useWorkspaceStore((s) => s.memberships);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeWorkspace = allWorkspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const assignmentsByResource = useAssignmentStore((s) => s.assignmentsByResource);
  const getProfile = useProfileStore((s) => s.getProfile);
  const authState = useAuthStore((s) => s.state);

  const selectedId = useTreeUiStore((s) => s.selectedId);
  const renamingId = useTreeUiStore((s) => s.renamingId);
  const setSelectedId = useTreeUiStore((s) => s.setSelected);
  const setRenamingId = useTreeUiStore((s) => s.setRenaming);
  const setDraggingIdStore = useTreeUiStore((s) => s.setDragging);
  const setDropTargetIdStore = useTreeUiStore((s) => s.setDropTarget);
  const setDimmedIdsStore = useTreeUiStore((s) => s.setDimmedIds);
  const resetDrag = useTreeUiStore((s) => s.resetDrag);
  const draggingIdRef = useRef<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [createModal, setCreateModal] = useState<CreateModalState | null>(null);
  const [colorTargetId, setColorTargetId] = useState<string | null>(null);
  const [logWorkResource, setLogWorkResource] = useState<Resource | null>(null);

  // Assignment filter state — reset to 'all' on workspace change
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>("all");

  // Detect Local_Personal_Workspace (owner_id === 'local')
  const isLocalWorkspace = activeWorkspace?.owner_id === "local";

  // Reset filter when workspace changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- assignment filter is scoped to the active workspace
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
  }, [refresh, activeWorkspaceId]);

  // Mirror dimmedIds into the tree-ui store so per-node TreeNode subscribers
  // can read their own dimmed boolean without re-rendering the whole tree.
  useEffect(() => {
    setDimmedIdsStore(dimmedIds);
  }, [dimmedIds, setDimmedIdsStore]);

  // Faza 7 presence: broadcast which resource the user is editing (log modal
  // or inline rename) so teammates see an "is editing" badge on the node.
  const setPresenceEditing = usePresenceStore((s) => s.setEditing);
  useEffect(() => {
    setPresenceEditing(logWorkResource?.id ?? renamingId ?? null);
  }, [logWorkResource, renamingId, setPresenceEditing]);
  useEffect(() => () => setPresenceEditing(null), [setPresenceEditing]);

  // Block native context menu globally on this view.
  useEffect(() => {
    const onCtx = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", onCtx);
    return () => document.removeEventListener("contextmenu", onCtx);
  }, []);

  const findResource = useCallback(
    (id: string): Resource | undefined => resources.find((r) => r.id === id),
    [resources],
  );

  const findCurrentResource = useCallback(
    (id: string): Resource | undefined =>
      useProjects.getState().resources.find((resource) => resource.id === id),
    [],
  );

  const resolveResourceColor = (resource: Resource): string => {
    if (resource.color) return resource.color;

    const ancestorIds = resource.path.split("/").slice(0, -1).reverse();
    for (const ancestorId of ancestorIds) {
      const ancestor = findResource(ancestorId);
      if (ancestor?.color) return ancestor.color;
    }

    return getDefaultColorForType(resource.type);
  };

  const handleContextEmpty = (e: React.MouseEvent) => {
    setMenu({ x: e.clientX, y: e.clientY, targetId: null });
  };

  const handleContextNode = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedId(id);
      setMenu({ x: e.clientX, y: e.clientY, targetId: id });
    },
    [setSelectedId],
  );

  const handleLogWork = useCallback(
    (id: string) => {
      const r = useProjects.getState().resources.find((res) => res.id === id);
      if (r) setLogWorkResource(r);
    },
    [],
  );

  const handleCommitRename = useCallback(
    async (id: string, name: string) => {
      await rename(id, name);
      setRenamingId(null);
    },
    [rename, setRenamingId],
  );

  const handleCancelRename = useCallback(() => {
    setRenamingId(null);
  }, [setRenamingId]);

  const handleDragStart = useCallback(
    (id: string) => {
      draggingIdRef.current = id;
      setDraggingIdStore(id);
    },
    [setDraggingIdStore],
  );

  const handleDragEnd = useCallback(() => {
    draggingIdRef.current = null;
    resetDrag();
  }, [resetDrag]);

  const openNewProjectPrompt = () => {
    setCreateModal({
      title: "Nowy Projekt",
      placeholder: "Nazwa projektu",
      initialColor: getDefaultColorForType("project"),
      presets: getColorPresetsForType("project"),
      onConfirm: async ({ name, color }) => {
        await addProject(name, color);
        setCreateModal(null);
      },
    });
  };

  const openAddChildPrompt = (parentId: string, type: ResourceType) => {
    const parent = findResource(parentId);
    const parentColor = parent ? resolveResourceColor(parent) : null;

    setCreateModal({
      title: `Dodaj ${TYPE_LABEL[type]}`,
      placeholder: `Nazwa: ${TYPE_LABEL[type].toLowerCase()}`,
      initialColor: getDefaultChildColor(parentColor, type),
      presets: getColorPresetsForType(type),
      onConfirm: async ({ name, color }) => {
        await addChild(parentId, name, type, color);
        setCreateModal(null);
      },
    });
  };

  // ---- Drag-drop ----

  const canDropOn = useCallback((sourceId: string, targetId: string | null): boolean => {
    const source = findCurrentResource(sourceId);
    if (!source) return false;
    if (targetId === null) {
      // Only a project may live at the top level.
      return source.type === "project";
    }
    if (sourceId === targetId) return false;
    const target = findCurrentResource(targetId);
    if (!target) return false;
    if (isDescendantPath(source.path, target.path)) return false;
    return canParent(target.type, source.type);
  }, [findCurrentResource]);

  const handleDragOver = useCallback(
    (e: React.DragEvent, id: string) => {
      const activeDraggingId = draggingIdRef.current ?? useTreeUiStore.getState().draggingId;
      if (!activeDraggingId) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const validDropTarget = canDropOn(activeDraggingId, id);
      const nextDropTargetId = validDropTarget ? id : null;
      setDropTargetIdStore(nextDropTargetId);
    },
    [canDropOn, setDropTargetIdStore],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent, id: string) => {
      const activeDraggingId = draggingIdRef.current ?? useTreeUiStore.getState().draggingId;
      if (!activeDraggingId) return;
      e.preventDefault();
      e.stopPropagation();
      const src = activeDraggingId;
      draggingIdRef.current = null;
      resetDrag();
      if (!canDropOn(src, id)) return;
      try {
        await move(src, id);
      } catch {
        /* validation error — silently ignore for MVP */
      }
    },
    [canDropOn, resetDrag, move],
  );

  const handleDragOverEmpty = (e: React.DragEvent) => {
    const activeDraggingId = draggingIdRef.current ?? useTreeUiStore.getState().draggingId;
    if (!activeDraggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDropEmpty = async (e: React.DragEvent) => {
    const activeDraggingId = draggingIdRef.current ?? useTreeUiStore.getState().draggingId;
    if (!activeDraggingId) return;
    e.preventDefault();
    const src = activeDraggingId;
    draggingIdRef.current = null;
    resetDrag();
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

    // "Assign members" — only available in non-local workspaces (Requirement 5.10)
    if (!isLocalWorkspace && activeWorkspaceId) {
      const assignItem: AssignMenuItem = {
        label: "Przypisz członków",
        assignAction: true,
        resourceId: node.id,
        workspaceId: activeWorkspaceId,
      };
      items.push(assignItem);
    }

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
      <header className="flex items-start justify-between gap-3 border-b border-neutral-800 px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-neutral-100">Projekty</h1>
        </div>
        <button
          type="button"
          onClick={openNewProjectPrompt}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
        >
          + Nowy projekt
        </button>
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
            Brak zasobów przypisanych do <span className="text-neutral-300">{emptyStateLabel}</span>
            .
          </div>
        ) : (
          <TreeView
            tree={filteredTree}
            onToggle={toggleExpanded}
            onSelect={setSelectedId}
            onContextMenu={handleContextNode}
            onContextMenuEmpty={handleContextEmpty}
            onDragOverEmpty={handleDragOverEmpty}
            onDropEmpty={handleDropEmpty}
            onLogWork={handleLogWork}
            onStartRename={setRenamingId}
            onCommitRename={handleCommitRename}
            onCancelRename={handleCancelRename}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
          />
        )}
      </main>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenuItems(menu.targetId)}
          onClose={() => setMenu(null)}
        />
      )}

      {createModal && (
        <CreateResourceModal
          title={createModal.title}
          placeholder={createModal.placeholder}
          confirmLabel="Utwórz"
          initialColor={createModal.initialColor}
          presets={createModal.presets}
          onConfirm={createModal.onConfirm}
          onCancel={() => setCreateModal(null)}
        />
      )}

      {colorTargetId && (
        <ColorPickerModal
          initial={findResource(colorTargetId)?.color ?? null}
          presets={getColorPresetsForType(findResource(colorTargetId)?.type ?? "project")}
          onConfirm={async (color) => {
            await changeColor(colorTargetId, color);
            setColorTargetId(null);
          }}
          onCancel={() => setColorTargetId(null)}
        />
      )}

      {logWorkResource && (
        <LogWorkModal
          resourceName={logWorkResource.name}
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
