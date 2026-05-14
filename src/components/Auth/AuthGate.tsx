import { LogOut, User } from 'lucide-react';
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
    return <span className="text-xs text-gray-400" aria-label="Loading authentication...">...</span>;
  }

  // Req 12.1: show Sign in button when anonymous
  if (state.kind === 'anonymous') {
    return (
      <>
        <button
          className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
          onClick={() => setOpen(true)}
        >
          Sign in
        </button>
        {open && <AuthModal onClose={() => setOpen(false)} />}
      </>
    );
  }

  // Req 12.2: show email + dropdown when authed
  const displayEmail = state.user.email ?? '';

  return (
    <div className="relative">
      <button
        className="flex w-full items-center gap-2 rounded border border-neutral-700 px-3 py-1.5 text-left text-xs text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
        onClick={() => setMenuOpen((v) => !v)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
      >
        <User size={14} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{displayEmail}</span>
      </button>
      {menuOpen && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-50 mb-1 w-full min-w-40 overflow-hidden rounded border border-neutral-700 bg-neutral-800 shadow-xl"
        >
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
            onClick={() => {
              setMenuOpen(false);
              setProfileOpen(true);
            }}
          >
            <User size={14} aria-hidden="true" />
            Profil
          </button>
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
            onClick={async () => {
              setMenuOpen(false);
              await signOut();
            }}
          >
            <LogOut size={14} aria-hidden="true" />
            Wyloguj się
          </button>
        </div>
      )}
      {profileOpen && <ProfileSettingsPanel onClose={() => setProfileOpen(false)} />}
    </div>
  );
}
