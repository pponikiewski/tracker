import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

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

export const useAuthStore = create<AuthStore>((set) => ({
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
    } else {
      set({ state: { kind: 'anonymous' } });
    }
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        set({
          state: { kind: 'authed', user: session.user, session },
        });
      } else {
        set({ state: { kind: 'anonymous' } });
      }
    });
  },

  signIn: async (email, password) => {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },

  signUp: async (email, password) => {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  },

  signOut: async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  },

  setSyncStatus: (s) => set({ syncStatus: s }),
  setPendingCount: (n) => set({ pendingCount: n }),
  setLastSyncAt: (t) => set({ lastSyncAt: t }),
}));
