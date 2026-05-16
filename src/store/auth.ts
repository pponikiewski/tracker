import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { ensureProfile } from '@/lib/profile/profileService';

export type AuthState =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | { kind: 'authed'; user: User; session: Session };

export type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'initial-pull' }
  | { kind: 'syncing' }
  | { kind: 'offline' }
  | { kind: 'error'; message: string };

interface AuthStore {
  state: AuthState;
  syncStatus: SyncStatus;
  pendingCount: number;
  lastSyncAt: number | null;
  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setSyncStatus: (s: SyncStatus) => void;
  setPendingCount: (n: number) => void;
  setLastSyncAt: (t: number) => void;
}

function syncStatusEqual(a: SyncStatus, b: SyncStatus): boolean {
  return a.kind === b.kind && (a.kind !== 'error' || b.kind !== 'error' || a.message === b.message);
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  state: { kind: 'loading' },
  syncStatus: { kind: 'idle' },
  pendingCount: 0,
  lastSyncAt: null,

  init: async () => {
    if (!supabase) {
      set({ state: { kind: 'anonymous' } });
      return;
    }
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      set({
        state: {
          kind: 'authed',
          user: data.session.user,
          session: data.session,
        },
      });
      // Ensure a profile record exists for the returning user (non-fatal).
      ensureProfile(data.session.user.id, data.session.user.email ?? '').catch(
        (err) => console.warn('[auth] ensureProfile failed on init:', err),
      );
    } else {
      set({ state: { kind: 'anonymous' } });
    }
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        set({
          state: { kind: 'authed', user: session.user, session },
        });
        ensureProfile(session.user.id, session.user.email ?? '').catch((err) =>
          console.warn('[auth] ensureProfile failed on auth state change:', err),
        );
      } else {
        set({ state: { kind: 'anonymous' } });
      }
    });
  },

  signIn: async (email, password) => {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // Ensure a profile record exists for the newly signed-in user (non-fatal).
    if (data.user) {
      ensureProfile(data.user.id, data.user.email ?? email).catch(
        (err) => console.warn('[auth] ensureProfile failed on signIn:', err),
      );
    }
  },

  signUp: async (email, password) => {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    if (data.user) {
      ensureProfile(data.user.id, data.user.email ?? email).catch((err) =>
        console.warn('[auth] ensureProfile failed on signUp:', err),
      );
    }
  },

  signOut: async () => {
    if (!supabase) return;
    try {
      const { tick } = await import('@/lib/sync/worker');
      await tick();
    } catch (err) {
      console.warn('[auth] final sync before signOut failed:', err);
    }
    await supabase.auth.signOut();
  },

  setSyncStatus: (s) => {
    if (!syncStatusEqual(get().syncStatus, s)) set({ syncStatus: s });
  },
  setPendingCount: (n) => {
    if (get().pendingCount !== n) set({ pendingCount: n });
  },
  setLastSyncAt: (t) => {
    if (get().lastSyncAt !== t) set({ lastSyncAt: t });
  },
}));
