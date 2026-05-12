import { create } from "zustand";
import type { Resource, ResourceNode, ResourceType } from "@/lib/db/types";
import {
  createEvent,
  createResource,
  detachChildrenAsProjects,
  liftChildrenAndDelete,
  listActiveResources,
  moveResource,
  renameResource,
  setResourceColor,
  softDeleteSubtree,
  type CreateEventInput,
} from "@/lib/db/queries";
import { buildTree } from "@/lib/utils/tree";
import { useWorkspaceStore } from "@/store/workspace";

interface ProjectsState {
  resources: Resource[];
  tree: ResourceNode[];
  expandedIds: Set<string>;
  loading: boolean;
  error: string | null;

  refresh: () => Promise<void>;
  toggleExpanded: (id: string) => void;

  addProject: (name: string) => Promise<void>;
  addChild: (parentId: string, name: string, type: ResourceType) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  move: (id: string, newParentId: string | null) => Promise<void>;
  changeColor: (id: string, color: string | null) => Promise<void>;
  deleteSubtree: (id: string) => Promise<void>;
  liftAndDelete: (id: string) => Promise<void>;
  detachAsProjects: (id: string) => Promise<void>;
  logTime: (input: Omit<CreateEventInput, "workspaceId">) => Promise<void>;
}

export const useProjects = create<ProjectsState>((set, get) => ({
  resources: [],
  tree: [],
  expandedIds: new Set(),
  loading: false,
  error: null,

  refresh: async () => {
    const activeWorkspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    if (activeWorkspaceId === null) {
      set({ resources: [], tree: [], loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      const resources = await listActiveResources(activeWorkspaceId);
      set({ resources, tree: buildTree(resources), loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },

  toggleExpanded: (id) => {
    const next = new Set(get().expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ expandedIds: next });
  },

  addProject: async (name) => {
    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    if (!workspaceId) return;
    await createResource({ parentId: null, name, type: "project", workspaceId });
    await get().refresh();
  },

  addChild: async (parentId, name, type) => {
    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    if (!workspaceId) return;
    await createResource({ parentId, name, type, workspaceId });
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
    await createEvent({ ...input, workspaceId });
    await get().refresh();
  },
}));
