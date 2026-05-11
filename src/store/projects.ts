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
  logTime: (input: CreateEventInput) => Promise<void>;
}

export const useProjects = create<ProjectsState>((set, get) => ({
  resources: [],
  tree: [],
  expandedIds: new Set(),
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const resources = await listActiveResources();
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
    await createResource({ parentId: null, name, type: "project" });
    await get().refresh();
  },

  addChild: async (parentId, name, type) => {
    await createResource({ parentId, name, type });
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
    await createEvent(input);
    await get().refresh();
  },
}));
