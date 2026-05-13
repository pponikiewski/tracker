import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import * as workspaceQueries from '@/lib/db/workspaceQueries';
import type { Workspace, WorkspaceMembership } from '@/lib/db/types';
import {
  generateJoinCode as svcGenerateJoinCode,
  listActiveJoinCodes as svcListActiveJoinCodes,
  revokeJoinCode as svcRevokeJoinCode,
  redeemJoinCode as svcRedeemJoinCode,
  type JoinCode,
} from '@/lib/workspace/joinCodeService';
import { useAssignmentStore } from '@/store/assignments';
import { useAuthStore } from '@/store/auth';
import { useProfileStore } from '@/store/profile';

// ---- Validation helpers ----

export function validateWorkspaceName(name: string): void {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new Error(
      'Workspace name must be between 1 and 80 characters (after trimming whitespace).',
    );
  }
}

// ---- localStorage key helpers ----

function lsKey(userId: string | null): string {
  return `tracker:activeWorkspaceId:${userId ?? 'anonymous'}`;
}

// ---- Store interface ----

interface WorkspaceState {
  workspaces: Workspace[];
  memberships: WorkspaceMembership[];
  activeWorkspaceId: string | null;
  loading: boolean;
  error: string | null;

  // Selectors (computed from state)
  activeWorkspace: () => Workspace | null;
  userWorkspaces: () => Workspace[];

  // Actions
  init: (userId: string | null) => Promise<void>;
  createWorkspace: (name: string) => Promise<string>;
  renameWorkspace: (id: string, name: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  setActiveWorkspace: (id: string) => Promise<void>;
  restoreActiveWorkspace: (userId: string | null) => Promise<void>;
  removeMember: (workspaceId: string, userId: string) => Promise<void>;
  generateJoinCode: (workspaceId: string) => Promise<JoinCode>;
  listActiveJoinCodes: (workspaceId: string) => Promise<JoinCode[]>;
  revokeJoinCode: (code: string) => Promise<void>;
  joinWorkspaceByCode: (code: string) => Promise<string>;
  refresh: () => Promise<void>;
}

// ---- Internal helpers (need access to store state) ----

/**
 * Returns the id of the currently authenticated user, or null if anonymous.
 * This MUST be the authoritative source — deriving userId from memberships
 * breaks for users who joined a workspace as a `member` (not `owner`).
 */
function getCurrentUserId(): string | null {
  const authState = useAuthStore.getState().state;
  return authState.kind === 'authed' ? authState.user.id : null;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  return {
    workspaces: [],
    memberships: [],
    activeWorkspaceId: null,
    loading: false,
    error: null,

    // ---- Selectors ----

    activeWorkspace: () => {
      const { workspaces, activeWorkspaceId } = get();
      if (!activeWorkspaceId) return null;
      return workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
    },

    userWorkspaces: () => {
      const { workspaces } = get();
      return workspaces
        .filter((w) => w.deleted_at === null)
        .sort((a, b) => a.created_at - b.created_at);
    },

    // ---- init ----

    init: async (userId: string | null) => {
      set({ loading: true, error: null });
      try {
        if (userId === null) {
          // Anonymous mode: use Local_Personal_Workspace
          const localId = await workspaceQueries.getOrCreateLocalWorkspace();
          const workspaces = await workspaceQueries.listWorkspaces();
          set({ workspaces, memberships: [], activeWorkspaceId: localId, loading: false });
        } else {
          // Authenticated mode.
          // First, adopt any Local_Personal_Workspace that still sits in SQLite
          // with owner_id = 'local'. After this the workspace becomes a
          // regular cloud workspace owned by the current user, preserving all
          // its projects and time events.
          const locals = await workspaceQueries.listLocalWorkspaces();
          for (const ws of locals) {
            try {
              await workspaceQueries.claimLocalWorkspace(ws.id, userId);
            } catch (err) {
              console.warn('[workspace] claimLocalWorkspace failed for', ws.id, err);
            }
          }

          const workspaces = await workspaceQueries.listWorkspaces();
          const memberships = await workspaceQueries.getUserMemberships(userId);
          set({ workspaces, memberships, loading: false });
          await get().restoreActiveWorkspace(userId);
        }
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },

    // ---- createWorkspace ----

    createWorkspace: async (name: string) => {
      validateWorkspaceName(name);
      const trimmed = name.trim();
      const id = crypto.randomUUID();

      const userId = getCurrentUserId();
      if (!userId) throw new Error('Cannot create workspace: no authenticated user.');

      try {
        await workspaceQueries.createWorkspace({ id, name: trimmed, ownerId: userId });
        await get().refresh();
        await get().setActiveWorkspace(id);
      } catch (err) {
        // Surface the underlying error so the caller sees something better
        // than a generic "Nieznany błąd".
        console.error('[workspace] createWorkspace failed:', err);
        throw err instanceof Error ? err : new Error(String(err));
      }
      return id;
    },

    // ---- renameWorkspace ----

    renameWorkspace: async (id: string, name: string) => {
      validateWorkspaceName(name);
      await workspaceQueries.renameWorkspace(id, name.trim());
      await get().refresh();
    },

    // ---- deleteWorkspace ----

    deleteWorkspace: async (id: string) => {
      await workspaceQueries.softDeleteWorkspace(id);

      const { activeWorkspaceId } = get();
      await get().refresh();

      if (activeWorkspaceId === id) {
        // Need to switch to another workspace
        const available = get().userWorkspaces();
        if (available.length > 0) {
          await get().setActiveWorkspace(available[0]!.id);
        } else {
          // No workspaces left — provision a new Personal_Workspace
          const userId = getCurrentUserId();
          if (!userId) throw new Error('Cannot provision workspace: no authenticated user.');
          const newId = crypto.randomUUID();
          await workspaceQueries.createWorkspace({
            id: newId,
            name: 'My workspace',
            ownerId: userId,
          });
          await get().refresh();
          await get().setActiveWorkspace(newId);
        }
      }
    },

    // ---- setActiveWorkspace ----

    setActiveWorkspace: async (id: string) => {
      set({ activeWorkspaceId: id });
      const userId = getCurrentUserId();
      try {
        localStorage.setItem(lsKey(userId), id);
      } catch {
        // localStorage may be unavailable in some environments; ignore
      }

      // Load assignments and profiles for the new active workspace
      // Requirements: 4.2, 5.1, 6.9
      try {
        const memberships = await workspaceQueries.listMemberships(id);
        // Exclude pseudo user_ids used by Local_Personal_Workspace — Supabase
        // expects UUIDs and returns 400 Bad Request for the sentinel 'local'.
        const memberIds = memberships
          .map((m) => m.user_id)
          .filter((uid) => uid !== 'local');

        await Promise.all([
          useAssignmentStore.getState().loadAssignments(id),
          memberIds.length > 0
            ? useProfileStore.getState().fetchProfiles(memberIds)
            : Promise.resolve(),
        ]);
      } catch {
        // Non-fatal: assignments/profiles will be stale but the workspace switch succeeds
      }
    },

    // ---- restoreActiveWorkspace ----

    restoreActiveWorkspace: async (userId: string | null) => {
      const { workspaces } = get();
      const available = workspaces.filter((w) => w.deleted_at === null);

      // Try to restore from localStorage
      let restoredId: string | null = null;
      try {
        restoredId = localStorage.getItem(lsKey(userId));
      } catch {
        // ignore
      }

      if (restoredId && available.some((w) => w.id === restoredId)) {
        await get().setActiveWorkspace(restoredId);
        return;
      }

      // Fallback: first non-deleted workspace
      if (available.length > 0) {
        const first = available.sort((a, b) => a.created_at - b.created_at)[0]!;
        await get().setActiveWorkspace(first.id);
        return;
      }

      // No workspaces at all — provision Personal_Workspace
      if (userId) {
        const newId = crypto.randomUUID();
        await workspaceQueries.createWorkspace({
          id: newId,
          name: 'My workspace',
          ownerId: userId,
        });
        await get().refresh();
        await get().setActiveWorkspace(newId);
      }
    },

    // ---- removeMember ----

    removeMember: async (workspaceId: string, userId: string) => {
      if (!supabase) throw new Error('Supabase not configured');

      // Delete from Supabase first
      const { error } = await supabase
        .from('workspace_memberships')
        .delete()
        .match({ workspace_id: workspaceId, user_id: userId });

      if (error) throw new Error(error.message);

      // Then delete from local SQLite
      await workspaceQueries.deleteMembership(workspaceId, userId);

      // Refresh memberships
      await get().refresh();
    },

    // ---- join codes ----

    generateJoinCode: async (workspaceId: string) => {
      return svcGenerateJoinCode(workspaceId);
    },

    listActiveJoinCodes: async (workspaceId: string) => {
      return svcListActiveJoinCodes(workspaceId);
    },

    revokeJoinCode: async (code: string) => {
      await svcRevokeJoinCode(code);
    },

    // ---- joinWorkspaceByCode ----

    joinWorkspaceByCode: async (code: string) => {
      if (!supabase) throw new Error('Supabase not configured');

      const workspaceId = await svcRedeemJoinCode(code);

      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
      if (!userId) throw new Error('Musisz być zalogowany, aby dołączyć do workspace.');

      // Fetch workspace row so we can mirror it locally.
      const { data: wsData, error: wsError } = await supabase
        .from('workspaces')
        .select('*')
        .eq('id', workspaceId)
        .single();

      if (wsError || !wsData) {
        throw new Error('Nie udało się pobrać workspace po dołączeniu.');
      }

      const ws = wsData as {
        id: string;
        name: string;
        owner_id: string;
        created_at: string;
        updated_at: string;
        deleted_at: string | null;
      };

      // Insert workspace row locally if not already present.
      const existing = await workspaceQueries.getWorkspace(ws.id);
      if (!existing) {
        await workspaceQueries.createWorkspace({
          id: ws.id,
          name: ws.name,
          ownerId: ws.owner_id,
        });
      }

      // Insert local membership for the newly joined user.
      await workspaceQueries.insertMembership({
        workspace_id: workspaceId,
        user_id: userId,
        role: 'member',
        joined_at: Date.now(),
      });

      await get().refresh();
      await get().setActiveWorkspace(workspaceId);
      return workspaceId;
    },

    // ---- refresh ----

    refresh: async () => {
      const userId = getCurrentUserId();
      const workspaces = await workspaceQueries.listWorkspaces();
      const memberships = userId
        ? await workspaceQueries.getUserMemberships(userId)
        : [];
      set({ workspaces, memberships });
    },
  };
});

