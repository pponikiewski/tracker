import type { RealtimeChannel } from '@supabase/supabase-js';
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { useProfileStore } from '@/store/profile';

/**
 * Faza 7 — Presence ("X is editing").
 *
 * Tracks which team members are online in the active workspace and what each
 * one currently has open in an editor, via a per-workspace Supabase Realtime
 * presence channel. Independent of the postgres_changes sync channel in
 * `worker.ts` — presence is workspace-scoped and ephemeral, so it has its own
 * channel and lifecycle (driven by an effect in `App.tsx`).
 */

export interface PresenceMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** Resource id the member currently has open in an editor, or null. */
  editingResourceId: string | null;
}

interface PresencePayload {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  editingResourceId: string | null;
  onlineAt: string;
}

interface PresenceState {
  members: PresenceMember[];
  /** Opens the per-workspace presence channel. Idempotent per workspace. */
  start: (workspaceId: string) => void;
  /** Closes the presence channel and clears members. */
  stop: () => void;
  /** Broadcasts which resource the current user is editing (null = nothing). */
  setEditing: (resourceId: string | null) => void;
}

let channel: RealtimeChannel | null = null;
let currentWorkspaceId: string | null = null;
let currentEditing: string | null = null;

function buildPayload(): PresencePayload | null {
  const auth = useAuthStore.getState().state;
  if (auth.kind !== 'authed') return null;
  const profile = useProfileStore.getState().getProfile(auth.user.id);
  return {
    userId: auth.user.id,
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
    editingResourceId: currentEditing,
    onlineAt: new Date().toISOString(),
  };
}

export const usePresenceStore = create<PresenceState>((set) => ({
  members: [],

  start: (workspaceId) => {
    if (!supabase) return;
    if (useAuthStore.getState().state.kind !== 'authed') return;
    // Already on this workspace's channel — nothing to do.
    if (channel && currentWorkspaceId === workspaceId) return;
    // Workspace changed — tear down the old channel first.
    if (channel) {
      void supabase.removeChannel(channel);
      channel = null;
    }
    currentWorkspaceId = workspaceId;
    currentEditing = null;

    const payload = buildPayload();
    if (!payload) return;

    const ch = supabase.channel(`presence:${workspaceId}`, {
      config: { presence: { key: payload.userId } },
    });

    ch.on('presence', { event: 'sync' }, () => {
      const raw = ch.presenceState<PresencePayload>();
      const members: PresenceMember[] = [];
      for (const entries of Object.values(raw)) {
        // Multiple tabs/devices share a presence key — first entry is enough.
        const first = entries[0];
        if (!first) continue;
        members.push({
          userId: first.userId,
          displayName: first.displayName,
          avatarUrl: first.avatarUrl,
          editingResourceId: first.editingResourceId,
        });
      }
      set({ members });
    });

    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void ch.track(buildPayload() ?? payload);
      }
    });

    channel = ch;
  },

  stop: () => {
    if (channel && supabase) void supabase.removeChannel(channel);
    channel = null;
    currentWorkspaceId = null;
    currentEditing = null;
    set({ members: [] });
  },

  setEditing: (resourceId) => {
    currentEditing = resourceId;
    if (channel) {
      const payload = buildPayload();
      if (payload) void channel.track(payload);
    }
  },
}));
