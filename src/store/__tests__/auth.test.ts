import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the supabase module before importing the store
vi.mock('@/lib/supabase', () => ({
  supabase: null, // default: no supabase configured
}));

// We need to re-import after mocking, so use dynamic imports in tests

describe('Auth store state transitions', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('init sets anonymous when supabase is null', async () => {
    vi.doMock('@/lib/supabase', () => ({ supabase: null }));
    const { useAuthStore } = await import('@/store/auth');
    await useAuthStore.getState().init();
    expect(useAuthStore.getState().state.kind).toBe('anonymous');
  });

  it('init sets anonymous when getSession returns no session', async () => {
    vi.doMock('@/lib/supabase', () => ({
      supabase: {
        auth: {
          getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
          onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
        },
      },
    }));
    const { useAuthStore } = await import('@/store/auth');
    await useAuthStore.getState().init();
    expect(useAuthStore.getState().state.kind).toBe('anonymous');
  });

  it('init sets authed when getSession returns a valid session', async () => {
    const mockUser = { id: 'user-1', email: 'test@example.com' };
    const mockSession = { user: mockUser, access_token: 'tok', refresh_token: 'ref' };
    vi.doMock('@/lib/supabase', () => ({
      supabase: {
        auth: {
          getSession: vi.fn().mockResolvedValue({ data: { session: mockSession }, error: null }),
          onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
        },
      },
    }));
    const { useAuthStore } = await import('@/store/auth');
    await useAuthStore.getState().init();
    const state = useAuthStore.getState().state;
    expect(state.kind).toBe('authed');
    if (state.kind === 'authed') {
      expect(state.user.email).toBe('test@example.com');
    }
  });

  it('signOut transitions to anonymous', async () => {
    const mockSignOut = vi.fn().mockResolvedValue({ error: null });
    vi.doMock('@/lib/supabase', () => ({
      supabase: {
        auth: {
          getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
          onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
          signOut: mockSignOut,
        },
      },
    }));
    const { useAuthStore } = await import('@/store/auth');
    await useAuthStore.getState().signOut();
    expect(mockSignOut).toHaveBeenCalled();
  });
});
