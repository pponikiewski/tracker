import { create } from "zustand";
import type { Resource, ResourceNode, ResourceType } from "@/lib/db/types";

function resourceEqual(a: Resource, b: Resource): boolean {
  return (
    a.id === b.id &&
    a.workspace_id === b.workspace_id &&
    a.parent_id === b.parent_id &&
    a.name === b.name &&
    a.type === b.type &&
    a.color === b.color &&
    a.path === b.path &&
    a.cached_minutes === b.cached_minutes &&
    a.created_at === b.created_at &&
    a.updated_at === b.updated_at &&
    a.deleted_at === b.deleted_at
  );
}
import {
  createEvent,
  createResource,
  deleteEvent,
  detachChildrenAsProjects,
  liftChildrenAndDelete,
  listActiveResources,
  moveResource,
  renameResource,
  setResourceColor,
  softDeleteSubtree,
  updateEvent,
  type CreateEventInput,
  type UpdateEventInput,
} from "@/lib/db/queries";
import { buildTree } from "@/lib/utils/tree";
import { useWorkspaceStore } from "@/store/workspace";
import { useAuthStore } from "@/store/auth";

interface ProjectsState {
  resources: Resource[];
  tree: ResourceNode[];
  expandedIds: Set<string>;
  loading: boolean;
  error: string | null;

  refresh: (options?: { showLoading?: boolean }) => Promise<void>;
  toggleExpanded: (id: string) => void;

  addProject: (name: string, color?: string | null) => Promise<void>;
  addChild: (
    parentId: string,
    name: string,
    type: ResourceType,
    color?: string | null,
  ) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  move: (id: string, newParentId: string | null) => Promise<void>;
  changeColor: (id: string, color: string | null) => Promise<void>;
  deleteSubtree: (id: string) => Promise<void>;
  liftAndDelete: (id: string) => Promise<void>;
  detachAsProjects: (id: string) => Promise<void>;
  logTime: (input: Omit<CreateEventInput, "workspaceId">) => Promise<void>;
  updateLog: (input: UpdateEventInput) => Promise<void>;
  deleteLog: (id: string) => Promise<void>;
}

export const useProjects = create<ProjectsState>((set, get) => ({
  resources: [],
  tree: [],
  expandedIds: new Set(),
  loading: false,
  error: null,

  refresh: async (options) => {
    const showLoading = options?.showLoading ?? true;
    const activeWorkspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    if (activeWorkspaceId === null) {
      const cur = get();
      if (cur.resources.length === 0 && cur.tree.length === 0 && !cur.loading && cur.error === null) {
        return;
      }
      set({ resources: [], tree: [], loading: false, error: null });
      return;
    }
    if (showLoading) {
      set((state) => (state.loading ? { error: null } : { loading: true, error: null }));
    } else if (get().error !== null) {
      set({ error: null });
    }
    try {
      const next = await listActiveResources(activeWorkspaceId);
      const prev = get().resources;
      const prevById = new Map(prev.map((r) => [r.id, r] as const));
      let allReused = next.length === prev.length;
      const reused: Resource[] = next.map((r, i) => {
        const old = prevById.get(r.id);
        if (old && resourceEqual(old, r)) {
          if (allReused && prev[i] !== old) allReused = false;
          return old;
        }
        allReused = false;
        return r;
      });
      if (allReused) {
        if (get().loading) set({ loading: false });
        return;
      }
      set({ resources: reused, tree: buildTree(reused), loading: false });
    } catch (e) {
      set((state) => ({
        error: e instanceof Error ? e.message : String(e),
        loading: showLoading ? false : state.loading,
      }));
    }
  },

  toggleExpanded: (id) => {
    const next = new Set(get().expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ expandedIds: next });
  },

  addProject: async (name, color) => {
    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    if (!workspaceId) return;
    await createResource({ parentId: null, name, type: "project", color, workspaceId });
    await get().refresh({ showLoading: false });
  },

  addChild: async (parentId, name, type, color) => {
    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    if (!workspaceId) return;
    await createResource({ parentId, name, type, color, workspaceId });
    set((s) => ({ expandedIds: new Set([...s.expandedIds, parentId]) }));
    await get().refresh({ showLoading: false });
  },

  rename: async (id, name) => {
    await renameResource(id, name);
    await get().refresh({ showLoading: false });
  },

  move: async (id, newParentId) => {
    await moveResource(id, newParentId);
    await get().refresh({ showLoading: false });
  },

  changeColor: async (id, color) => {
    await setResourceColor(id, color);
    await get().refresh({ showLoading: false });
  },

  deleteSubtree: async (id) => {
    await softDeleteSubtree(id);
    await get().refresh({ showLoading: false });
  },

  liftAndDelete: async (id) => {
    await liftChildrenAndDelete(id);
    await get().refresh({ showLoading: false });
  },

  detachAsProjects: async (id) => {
    await detachChildrenAsProjects(id);
    await get().refresh({ showLoading: false });
  },

  logTime: async (input) => {
    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    if (!workspaceId) return;
    const authState = useAuthStore.getState().state;
    const userId = authState.kind === "authed" ? authState.user.id : null;
    await createEvent({ ...input, workspaceId, userId });
    await get().refresh({ showLoading: false });
  },

  updateLog: async (input) => {
    await updateEvent(input);
    await get().refresh({ showLoading: false });
  },

  deleteLog: async (id) => {
    await deleteEvent(id);
    await get().refresh({ showLoading: false });
  },
}));
