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

export function replaceWorkspaceMemberships(
  current: WorkspaceMembership[],
  workspaceId: string,
  nextForWorkspace: WorkspaceMembership[],
): WorkspaceMembership[] {
  return [
    ...current.filter((m) => m.workspace_id !== workspaceId),
    ...nextForWorkspace,
  ];
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
          // Authenticated mode: do not auto-claim Local_Personal_Workspace
          // before cloud pull. Team members would otherwise land in a new
          // empty "My workspace" instead of their joined workspace.
          const workspaces = (await workspaceQueries.listWorkspaces()).filter(
            (w) => w.owner_id !== 'local',
          );
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
          set({ activeWorkspaceId: null });
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
        set((state) => ({
          memberships: replaceWorkspaceMemberships(state.memberships, id, memberships),
        }));
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

      // No workspaces at all — show the explicit create/join empty state.
      if (userId) {
        // Authenticated cloud users are provisioned by initial pull, after
        // Supabase has had a chance to return owned and joined workspaces.
        // Creating here caused members of an existing team workspace to get a
        // duplicate local/cloud "My workspace" during login.
        set({ activeWorkspaceId: null });
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

      const { data: membershipData, error: membershipError } = await supabase
        .from('workspace_memberships')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .single();

      if (membershipError || !membershipData) {
        throw new Error('Nie udało się pobrać membership po dołączeniu.');
      }

      const membership = membershipData as {
        workspace_id: string;
        user_id: string;
        role: 'owner' | 'member';
        joined_at: string;
      };

      await workspaceQueries.upsertWorkspaceLocal({
        id: ws.id,
        name: ws.name,
        owner_id: ws.owner_id,
        created_at: Date.parse(ws.created_at),
        updated_at: Date.parse(ws.updated_at),
        deleted_at: ws.deleted_at ? Date.parse(ws.deleted_at) : null,
      });

      // Mirror the server-created membership locally. Do not enqueue it:
      // redeem_workspace_join_code already wrote it in Supabase.
      await workspaceQueries.upsertMembershipLocal({
        workspace_id: membership.workspace_id,
        user_id: membership.user_id,
        role: membership.role,
        joined_at: Date.parse(membership.joined_at),
      });

      await get().refresh();
      await get().setActiveWorkspace(workspaceId);
      const { pullNow } = await import('@/lib/sync/worker');
      await pullNow();
      await get().refresh();
      await get().setActiveWorkspace(workspaceId);
      return workspaceId;
    },

    // ---- refresh ----

    refresh: async () => {
      const userId = getCurrentUserId();
      const allWorkspaces = await workspaceQueries.listWorkspaces();
      const workspaces = userId
        ? allWorkspaces.filter((w) => w.owner_id !== 'local')
        : allWorkspaces;
      const activeWorkspaceId = get().activeWorkspaceId;
      const memberships = activeWorkspaceId
        ? await workspaceQueries.listMemberships(activeWorkspaceId)
        : userId
          ? await workspaceQueries.getUserMemberships(userId)
          : [];
      set({ workspaces, memberships });
    },
  };
});

