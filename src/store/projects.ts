import { create } from "zustand";
import type { Resource, ResourceNode, ResourceType } from "@/lib/db/types";
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
      set({ resources: [], tree: [], loading: false, error: null });
      return;
    }
    set((state) => ({ loading: showLoading ? true : state.loading, error: null }));
    try {
      const resources = await listActiveResources(activeWorkspaceId);
      set({ resources, tree: buildTree(resources), loading: false });
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
    await get().refresh();
  },

  addChild: async (parentId, name, type, color) => {
    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    if (!workspaceId) return;
    await createResource({ parentId, name, type, color, workspaceId });
    set((s) => ({ expandedIds: new Set([...s.expandedIds, parentId]) }));
    await get().refresh();
  },

  rename: async (id, name) => {
    await renameResource(id, name);
    await get().refresh();
  },

  move: async (id, newParentId) => {
    await moveResource(id, newParentId);
    await get().refresh();
  },

  changeColor: async (id, color) => {
    await setResourceColor(id, color);
    await get().refresh();
  },

  deleteSubtree: async (id) => {
    await softDeleteSubtree(id);
    await get().refresh();
  },

  liftAndDelete: async (id) => {
    await liftChildrenAndDelete(id);
    await get().refresh();
  },

  detachAsProjects: async (id) => {
    await detachChildrenAsProjects(id);
    await get().refresh();
  },

  logTime: async (input) => {
    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    if (!workspaceId) return;
    const authState = useAuthStore.getState().state;
    const userId = authState.kind === "authed" ? authState.user.id : null;
    await createEvent({ ...input, workspaceId, userId });
    await get().refresh();
  },

  updateLog: async (input) => {
    await updateEvent(input);
    await get().refresh();
  },

  deleteLog: async (id) => {
    await deleteEvent(id);
    await get().refresh();
  },
}));
