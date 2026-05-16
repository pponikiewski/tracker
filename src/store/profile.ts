import { create } from 'zustand';
import type { CachedProfile } from '@/lib/db/types';
import {
  clearAvatarUrl,
  fetchAndCacheProfiles,
  setAvatarColor as persistAvatarColor,
  upsertProfile,
  validateDisplayName,
} from '@/lib/profile/profileService';
import { uploadAvatar as uploadAvatarFile } from '@/lib/profile/avatarService';
import { useAuthStore } from '@/store/auth';

interface ProfileState {
  profiles: Record<string, CachedProfile>;
  loading: boolean;
  error: string | null;

  fetchProfiles: (userIds: string[]) => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  clearAvatar: () => Promise<void>;
  setAvatarColor: (color: string | null) => Promise<void>;
  getProfile: (userId: string) => CachedProfile;
}

function emptyProfile(userId: string, displayName: string): CachedProfile {
  return {
    user_id: userId,
    display_name: displayName,
    avatar_url: null,
    avatar_color: null,
    cached_at: Date.now(),
  };
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: {},
  loading: false,
  error: null,

  fetchProfiles: async (userIds: string[]) => {
    if (userIds.length === 0) return;

    set({ loading: true, error: null });
    try {
      const fetched = await fetchAndCacheProfiles(userIds);
      set((state) => {
        const updated = { ...state.profiles };
        for (const profile of fetched) {
          updated[profile.user_id] = profile;
        }
        return { profiles: updated, loading: false };
      });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  updateDisplayName: async (displayName: string) => {
    const trimmed = validateDisplayName(displayName);

    const authState = useAuthStore.getState().state;
    if (authState.kind !== 'authed') {
      throw new Error('Cannot update display name: not authenticated.');
    }
    const userId = authState.user.id;

    set({ loading: true, error: null });
    try {
      await upsertProfile(userId, trimmed);
      set((state) => {
        const existing = state.profiles[userId] ?? emptyProfile(userId, trimmed);
        return {
          profiles: {
            ...state.profiles,
            [userId]: { ...existing, display_name: trimmed, cached_at: Date.now() },
          },
          loading: false,
        };
      });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  uploadAvatar: async (file: File) => {
    const authState = useAuthStore.getState().state;
    if (authState.kind !== 'authed') {
      throw new Error('Cannot upload avatar: not authenticated.');
    }
    const userId = authState.user.id;

    set({ loading: true, error: null });
    try {
      const newUrl = await uploadAvatarFile(userId, file);
      set((state) => {
        const existing = state.profiles[userId] ?? emptyProfile(userId, '');
        return {
          profiles: {
            ...state.profiles,
            [userId]: { ...existing, avatar_url: newUrl, cached_at: Date.now() },
          },
          loading: false,
        };
      });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  clearAvatar: async () => {
    const authState = useAuthStore.getState().state;
    if (authState.kind !== 'authed') {
      throw new Error('Cannot clear avatar: not authenticated.');
    }
    const userId = authState.user.id;

    set({ loading: true, error: null });
    try {
      await clearAvatarUrl(userId);
      set((state) => {
        const existing = state.profiles[userId] ?? emptyProfile(userId, '');
        return {
          profiles: {
            ...state.profiles,
            [userId]: { ...existing, avatar_url: null, cached_at: Date.now() },
          },
          loading: false,
        };
      });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  setAvatarColor: async (color: string | null) => {
    const authState = useAuthStore.getState().state;
    if (authState.kind !== 'authed') {
      throw new Error('Cannot set avatar color: not authenticated.');
    }
    const userId = authState.user.id;

    set({ loading: true, error: null });
    try {
      await persistAvatarColor(userId, color);
      set((state) => {
        const existing = state.profiles[userId] ?? emptyProfile(userId, '');
        return {
          profiles: {
            ...state.profiles,
            [userId]: { ...existing, avatar_color: color, cached_at: Date.now() },
          },
          loading: false,
        };
      });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  getProfile: (userId: string): CachedProfile => {
    const { profiles } = get();
    const cached = profiles[userId];
    if (cached) return cached;

    let fallbackDisplayName = userId;

    const authState = useAuthStore.getState().state;
    if (authState.kind === 'authed' && authState.user.id === userId) {
      const email = authState.user.email ?? userId;
      fallbackDisplayName = email.split('@')[0] ?? userId;
    }

    return {
      user_id: userId,
      display_name: fallbackDisplayName,
      avatar_url: null,
      avatar_color: null,
      cached_at: 0,
    };
  },
}));
