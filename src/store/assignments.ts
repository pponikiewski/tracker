import { create } from 'zustand';
import {
  createAssignment,
  removeAssignment,
  listAssignments,
} from '@/lib/assignments/assignmentService';

// ---- Store interface ----

interface AssignmentState {
  // Keyed by resource_id → array of user_ids (active assignees only)
  assignmentsByResource: Record<string, string[]>;
  loading: boolean;
  error: string | null;

  // Load all active assignments for the given workspace from local SQLite
  loadAssignments: (workspaceId: string) => Promise<void>;
  // Assign a member to a resource (idempotent — no-op if already assigned)
  assign: (resourceId: string, userId: string, workspaceId: string) => Promise<void>;
  // Remove an assignment (idempotent — no-op if not assigned)
  unassign: (resourceId: string, userId: string, workspaceId: string) => Promise<void>;
  // Get the list of user_ids assigned to a resource (empty array if none)
  getAssignees: (resourceId: string) => string[];
}

// ---- Store implementation ----

export const useAssignmentStore = create<AssignmentState>((set, get) => ({
  assignmentsByResource: {},
  loading: false,
  error: null,

  // ---- loadAssignments ----

  loadAssignments: async (workspaceId: string) => {
    set({ loading: true, error: null });
    try {
      const assignments = await listAssignments(workspaceId);

      // Build the resource → user_ids map from the flat list
      const byResource: Record<string, string[]> = {};
      for (const a of assignments) {
        if (!byResource[a.resource_id]) {
          byResource[a.resource_id] = [];
        }
        byResource[a.resource_id]!.push(a.user_id);
      }

      set({ assignmentsByResource: byResource, loading: false });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  // ---- assign ----

  assign: async (resourceId: string, userId: string, workspaceId: string) => {
    set({ error: null });
    try {
      await createAssignment(resourceId, userId, workspaceId);

      // Optimistically update the in-memory map
      set((state) => {
        const current = state.assignmentsByResource[resourceId] ?? [];
        if (current.includes(userId)) {
          // Already present — no change needed
          return state;
        }
        return {
          assignmentsByResource: {
            ...state.assignmentsByResource,
            [resourceId]: [...current, userId],
          },
        };
      });
    } catch (e) {
      set({ error: (e as Error).message });
      throw e;
    }
  },

  // ---- unassign ----

  unassign: async (resourceId: string, userId: string, workspaceId: string) => {
    set({ error: null });
    try {
      await removeAssignment(resourceId, userId, workspaceId);

      // Optimistically update the in-memory map
      set((state) => {
        const current = state.assignmentsByResource[resourceId] ?? [];
        const updated = current.filter((id) => id !== userId);
        const next = { ...state.assignmentsByResource };
        if (updated.length === 0) {
          delete next[resourceId];
        } else {
          next[resourceId] = updated;
        }
        return { assignmentsByResource: next };
      });
    } catch (e) {
      set({ error: (e as Error).message });
      throw e;
    }
  },

  // ---- getAssignees ----

  getAssignees: (resourceId: string) => {
    return get().assignmentsByResource[resourceId] ?? [];
  },
}));
