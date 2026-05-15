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
  getEvent,
  getResource,
  liftChildrenAndDelete,
  listActiveResources,
  listResourcesByIds,
  moveResource,
  renameResource,
  setResourceColor,
  softDeleteSubtree,
  updateEvent,
  type CreateEventInput,
  type UpdateEventInput,
} from "@/lib/db/queries";
import { buildTree } from "@/lib/utils/tree";
import { newId } from "@/lib/utils/uuid";
import { useWorkspaceStore } from "@/store/workspace";
import { useAuthStore } from "@/store/auth";

function compareResources(a: Resource, b: Resource): number {
  return (
    a.path.localeCompare(b.path, undefined, { sensitivity: "base" }) ||
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
    a.created_at - b.created_at
  );
}

function mergeResourceRows(current: Resource[], rows: Resource[]): Resource[] {
  if (rows.length === 0) return current;

  const byId = new Map(current.map((resource) => [resource.id, resource] as const));
  let changed = false;

  for (const row of rows) {
    if (row.deleted_at !== null) {
      if (byId.delete(row.id)) changed = true;
      continue;
    }

    const previous = byId.get(row.id);
    if (previous && resourceEqual(previous, row)) continue;
    byId.set(row.id, row);
    changed = true;
  }

  if (!changed) return current;
  return [...byId.values()].sort(compareResources);
}

function adjustCachedMinutes(current: Resource[], ids: string[], delta: number): Resource[] {
  if (delta === 0 || ids.length === 0) return current;
  const affected = new Set(ids);
  let changed = false;
  const next = current.map((resource) => {
    if (!affected.has(resource.id)) return resource;
    changed = true;
    return { ...resource, cached_minutes: Math.max(0, resource.cached_minutes + delta) };
  });
  return changed ? next : current;
}

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
      set((state) => ({ resources: reused, tree: buildTree(reused, state.tree), loading: false }));
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
    const id = newId();
    const timestamp = Date.now();
    const optimistic: Resource = {
      id,
      workspace_id: workspaceId,
      parent_id: null,
      name,
      type: "project",
      color: color ?? null,
      path: id,
      cached_minutes: 0,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    };
    set((state) => {
      const resources = mergeResourceRows(state.resources, [optimistic]);
      return { resources, tree: buildTree(resources, state.tree), error: null };
    });
    try {
      await createResource({
        id,
        parentId: null,
        name,
        type: "project",
        color,
        workspaceId,
        timestamp,
      });
      const created = await getResource(id);
      if (created) {
        set((state) => {
          const resources = mergeResourceRows(state.resources, [created]);
          if (resources === state.resources) return state;
          return { ...state, resources, tree: buildTree(resources, state.tree) };
        });
      }
    } catch (error) {
      set((state) => {
        const resources = state.resources.filter((resource) => resource.id !== id);
        return { ...state, resources, tree: buildTree(resources, state.tree) };
      });
      throw error;
    }
  },

  addChild: async (parentId, name, type, color) => {
    const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    if (!workspaceId) return;
    const parent = get().resources.find((resource) => resource.id === parentId);
    if (!parent) return;
    const id = newId();
    const timestamp = Date.now();
    const optimistic: Resource = {
      id,
      workspace_id: workspaceId,
      parent_id: parentId,
      name,
      type,
      color: color ?? null,
      path: `${parent.path}/${id}`,
      cached_minutes: 0,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    };
    set((s) => ({ expandedIds: new Set([...s.expandedIds, parentId]) }));
    set((state) => {
      const resources = mergeResourceRows(state.resources, [optimistic]);
      return { resources, tree: buildTree(resources, state.tree), error: null };
    });
    try {
      await createResource({
        id,
        parentId,
        name,
        type,
        color,
        workspaceId,
        timestamp,
      });
      const created = await getResource(id);
      if (created) {
        set((state) => {
          const resources = mergeResourceRows(state.resources, [created]);
          if (resources === state.resources) return state;
          return { ...state, resources, tree: buildTree(resources, state.tree) };
        });
      }
    } catch (error) {
      set((state) => {
        const resources = state.resources.filter((resource) => resource.id !== id);
        return { ...state, resources, tree: buildTree(resources, state.tree) };
      });
      throw error;
    }
  },

  rename: async (id, name) => {
    const previous = get().resources.find((resource) => resource.id === id);
    if (previous) {
      set((state) => {
        const resources = mergeResourceRows(state.resources, [
          { ...previous, name, updated_at: Date.now() },
        ]);
        return { resources, tree: buildTree(resources, state.tree), error: null };
      });
    }
    try {
      await renameResource(id, name);
      const changed = await getResource(id);
      if (changed) {
        set((state) => {
          const resources = mergeResourceRows(state.resources, [changed]);
          if (resources === state.resources) return state;
          return { ...state, resources, tree: buildTree(resources, state.tree) };
        });
      }
    } catch (error) {
      if (previous) {
        set((state) => {
          const resources = mergeResourceRows(state.resources, [previous]);
          return { ...state, resources, tree: buildTree(resources, state.tree) };
        });
      }
      throw error;
    }
  },

  move: async (id, newParentId) => {
    await moveResource(id, newParentId);
    await get().refresh({ showLoading: false });
  },

  changeColor: async (id, color) => {
    const previous = get().resources.find((resource) => resource.id === id);
    if (previous) {
      set((state) => {
        const resources = mergeResourceRows(state.resources, [
          { ...previous, color, updated_at: Date.now() },
        ]);
        return { resources, tree: buildTree(resources, state.tree), error: null };
      });
    }
    try {
      await setResourceColor(id, color);
      const changed = await getResource(id);
      if (changed) {
        set((state) => {
          const resources = mergeResourceRows(state.resources, [changed]);
          if (resources === state.resources) return state;
          return { ...state, resources, tree: buildTree(resources, state.tree) };
        });
      }
    } catch (error) {
      if (previous) {
        set((state) => {
          const resources = mergeResourceRows(state.resources, [previous]);
          return { ...state, resources, tree: buildTree(resources, state.tree) };
        });
      }
      throw error;
    }
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
    const target = get().resources.find((resource) => resource.id === input.resourceId);
    const affectedIds = target ? target.path.split("/") : [input.resourceId];
    const id = newId();
    const timestamp = Date.now();
    set((state) => {
      const resources = adjustCachedMinutes(state.resources, affectedIds, input.minutes);
      if (resources === state.resources) return state;
      return { ...state, resources, tree: buildTree(resources, state.tree), error: null };
    });
    try {
      await createEvent({ id, timestamp, ...input, workspaceId, userId });
      const changed = await listResourcesByIds(affectedIds);
      set((state) => {
        const resources = mergeResourceRows(state.resources, changed);
        if (resources === state.resources) return state;
        return { ...state, resources, tree: buildTree(resources, state.tree) };
      });
    } catch (error) {
      set((state) => {
        const resources = adjustCachedMinutes(state.resources, affectedIds, -input.minutes);
        if (resources === state.resources) return state;
        return { ...state, resources, tree: buildTree(resources, state.tree) };
      });
      throw error;
    }
  },

  updateLog: async (input) => {
    const previous = await getEvent(input.id);
    const affectedIds =
      previous?.resource_id
        ? get().resources.find((resource) => resource.id === previous.resource_id)?.path.split("/")
        : undefined;
    const delta = previous ? input.minutes - previous.minutes : 0;
    if (affectedIds && delta !== 0) {
      set((state) => {
        const resources = adjustCachedMinutes(state.resources, affectedIds, delta);
        if (resources === state.resources) return state;
        return { ...state, resources, tree: buildTree(resources, state.tree), error: null };
      });
    }
    await updateEvent(input);
    if (affectedIds) {
      const changed = await listResourcesByIds(affectedIds);
      set((state) => {
        const resources = mergeResourceRows(state.resources, changed);
        if (resources === state.resources) return state;
        return { ...state, resources, tree: buildTree(resources, state.tree) };
      });
    }
  },

  deleteLog: async (id) => {
    const previous = await getEvent(id);
    const affectedIds =
      previous?.resource_id
        ? get().resources.find((resource) => resource.id === previous.resource_id)?.path.split("/")
        : undefined;
    if (previous && affectedIds) {
      set((state) => {
        const resources = adjustCachedMinutes(state.resources, affectedIds, -previous.minutes);
        if (resources === state.resources) return state;
        return { ...state, resources, tree: buildTree(resources, state.tree), error: null };
      });
    }
    await deleteEvent(id);
    if (affectedIds) {
      const changed = await listResourcesByIds(affectedIds);
      set((state) => {
        const resources = mergeResourceRows(state.resources, changed);
        if (resources === state.resources) return state;
        return { ...state, resources, tree: buildTree(resources, state.tree) };
      });
    }
  },
}));
