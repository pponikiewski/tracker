import { create } from 'zustand';
import type { CachedProfile } from '@/lib/db/types';
import {
  fetchAndCacheProfiles,
  upsertProfile,
  validateDisplayName,
} from '@/lib/profile/profileService';
import { uploadAvatar as uploadAvatarFile } from '@/lib/profile/avatarService';
import { useAuthStore } from '@/store/auth';

// ---- State interface ----

interface ProfileState {
  /** Profiles keyed by user_id */
  profiles: Record<string, CachedProfile>;
  loading: boolean;
  error: string | null;

  /**
   * Fetch profiles for the given user IDs from Supabase and cache them locally.
   * Requirements: 1.6, 2.8, 4.2
   */
  fetchProfiles: (userIds: string[]) => Promise<void>;

  /**
   * Update the current user's display name in Supabase and the local cache.
   * Requirements: 1.6, 3.4
   */
  updateDisplayName: (displayName: string) => Promise<void>;

  /**
   * Upload a new avatar for the current user.
   * Requirements: 2.8, 3.8
   */
  uploadAvatar: (file: File) => Promise<void>;

  /**
   * Return the cached profile for a user_id, or a fallback CachedProfile
   * (email prefix as display_name, null avatar_url) when not found.
   * Requirements: 9.3
   */
  getProfile: (userId: string) => CachedProfile;
}

// ---- Store ----

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: {},
  loading: false,
  error: null,

  // ---- fetchProfiles ----

  fetchProfiles: async (userIds: string[]) => {
    if (userIds.length === 0) return;

    set({ loading: true, error: null });
    try {
      const fetched = await fetchAndCacheProfiles(userIds);

      // Merge fetched profiles into the store map
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

  // ---- updateDisplayName ----

  updateDisplayName: async (displayName: string) => {
    // Validate client-side first (throws with specific message on failure)
    const trimmed = validateDisplayName(displayName);

    const authState = useAuthStore.getState().state;
    if (authState.kind !== 'authed') {
      throw new Error('Cannot update display name: not authenticated.');
    }
    const userId = authState.user.id;

    set({ loading: true, error: null });
    try {
      await upsertProfile(userId, trimmed);

      // Update the in-memory profile entry
      set((state) => {
        const existing = state.profiles[userId];
        const updated: CachedProfile = {
          user_id: userId,
          display_name: trimmed,
          avatar_url: existing?.avatar_url ?? null,
          cached_at: Date.now(),
        };
        return {
          profiles: { ...state.profiles, [userId]: updated },
          loading: false,
        };
      });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  // ---- uploadAvatar ----

  uploadAvatar: async (file: File) => {
    const authState = useAuthStore.getState().state;
    if (authState.kind !== 'authed') {
      throw new Error('Cannot upload avatar: not authenticated.');
    }
    const userId = authState.user.id;

    set({ loading: true, error: null });
    try {
      const newUrl = await uploadAvatarFile(userId, file);

      // Update the in-memory profile entry with the new avatar URL
      set((state) => {
        const existing = state.profiles[userId];
        const updated: CachedProfile = {
          user_id: userId,
          display_name: existing?.display_name ?? '',
          avatar_url: newUrl,
          cached_at: Date.now(),
        };
        return {
          profiles: { ...state.profiles, [userId]: updated },
          loading: false,
        };
      });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  // ---- getProfile ----

  /**
   * Returns the cached profile for the given user_id.
   *
   * If no profile is found in the cache, returns a fallback CachedProfile
   * whose display_name is derived from the current user's email prefix
   * (when the requested user_id matches the authenticated user) or the
   * user_id itself (for other users), and whose avatar_url is null.
   *
   * Requirements: 9.3
   */
  getProfile: (userId: string): CachedProfile => {
    const { profiles } = get();
    const cached = profiles[userId];
    if (cached) return cached;

    // Build a fallback profile
    let fallbackDisplayName = userId;

    const authState = useAuthStore.getState().state;
    if (authState.kind === 'authed' && authState.user.id === userId) {
      // Use email prefix for the current user
      const email = authState.user.email ?? userId;
      fallbackDisplayName = email.split('@')[0] ?? userId;
    }

    return {
      user_id: userId,
      display_name: fallbackDisplayName,
      avatar_url: null,
      cached_at: 0,
    };
  },
}));
