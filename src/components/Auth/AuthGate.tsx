import { useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { AuthModal } from './AuthModal';
import { ProfileSettingsPanel } from '@/components/Profile/ProfileSettingsPanel';
import { supabase } from '@/lib/supabase';

export function AuthGate() {
  const state = useAuthStore((s) => s.state);
  const signOut = useAuthStore((s) => s.signOut);
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  // Req 1.2: hide entirely when supabase client is null (env vars missing)
  if (!supabase) return null;

  // Req 12.4: show spinner while loading
  if (state.kind === 'loading') {
    return <span className="text-xs text-gray-400" aria-label="Loading authentication…">…</span>;
  }

  // Req 12.1: show Sign in button when anonymous
  if (state.kind === 'anonymous') {
    return (
      <>
        <button
          className="text-xs px-3 py-1 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 transition-colors"
          onClick={() => setOpen(true)}>
          Sign in
        </button>
        {open && <AuthModal onClose={() => setOpen(false)} />}
      </>
    );
  }

  // Req 12.2: show truncated email + dropdown when authed
  const displayEmail = (state.user.email ?? '').slice(0, 30);

  return (
    <div className="relative">
      <button
        className="text-xs px-3 py-1 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 transition-colors"
        onClick={() => setMenuOpen((v) => !v)}
        aria-expanded={menuOpen}
        aria-haspopup="menu">
        👤 {displayEmail}
      </button>
      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 mt-1 bg-neutral-800 border border-neutral-700 shadow-xl rounded min-w-40 z-50">
          <button
            role="menuitem"
            className="w-full text-left px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100 transition-colors"
            onClick={() => {
              setMenuOpen(false);
              setProfileOpen(true);
            }}>
            Profile
          </button>
          <button
            role="menuitem"
            className="w-full text-left px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100 transition-colors"
            onClick={async () => {
              setMenuOpen(false);
              await signOut();
            }}>
            Sign out
          </button>
        </div>
      )}
      {profileOpen && <ProfileSettingsPanel onClose={() => setProfileOpen(false)} />}
    </div>
  );
}
