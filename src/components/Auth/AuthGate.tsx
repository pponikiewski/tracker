import { Database, LogOut, User } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth';
import { AuthModal } from './AuthModal';
import { SyncStatusBadge } from './SyncStatusBadge';
import { UpdateStatusBadge } from '@/components/Updater/UpdateStatusBadge';
import { ProfileSettingsPanel } from '@/components/Profile/ProfileSettingsPanel';
import { supabase } from '@/lib/supabase';
import type { Tab } from '@/components/Sidebar/Sidebar';

type MenuPlacement = 'top' | 'bottom-end';

interface AuthGateProps {
  menuPlacement?: MenuPlacement;
  onTabChange?: (tab: Tab) => void;
  collapsed?: boolean;
}

export function AuthGate({ menuPlacement = 'top', onTabChange, collapsed = false }: AuthGateProps) {
  const state = useAuthStore((s) => s.state);
  const signOut = useAuthStore((s) => s.signOut);
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [menuOpen]);

  const menuPositionClass =
    menuPlacement === 'bottom-end'
      ? 'right-0 top-full mt-1 w-64'
      : 'bottom-full left-0 mb-2 min-w-56';

  // Req 1.2: hide entirely when supabase client is null (env vars missing)
  if (!supabase) return null;

  // Req 12.4: show spinner while loading
  if (state.kind === 'loading') {
    return <span className="text-xs text-gray-400" aria-label="Ładowanie logowania...">...</span>;
  }

  // Req 12.1: show sign-in button when anonymous
  if (state.kind === 'anonymous') {
    return (
      <>
        <button
          className={`flex items-center justify-center rounded border border-neutral-700 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 ${collapsed ? "w-full p-1.5" : "w-full px-3 py-1"}`}
          title={collapsed ? "Zaloguj się" : undefined}
          onClick={() => setOpen(true)}
        >
          {collapsed ? <User size={14} aria-hidden="true" /> : "Zaloguj się"}
        </button>
        {open && <AuthModal onClose={() => setOpen(false)} />}
      </>
    );
  }

  // Req 12.2: show email + dropdown when authed
  const displayEmail = state.user.email ?? '';

  return (
    <div className="relative" ref={containerRef}>
      <button
        className={`flex items-center rounded border border-neutral-700 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 ${collapsed ? "w-full justify-center gap-0 p-1.5" : "w-full gap-2 px-3 py-1.5 text-left"}`}
        onClick={() => setMenuOpen((v) => !v)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        title={collapsed ? displayEmail : undefined}
      >
        <User size={14} aria-hidden="true" />
        {!collapsed && <span className="min-w-0 flex-1 truncate">{displayEmail}</span>}
      </button>
      {menuOpen && (
        <div
          role="menu"
          className={`absolute z-50 overflow-hidden rounded border border-neutral-700 bg-neutral-800 shadow-xl ${menuPositionClass}`}
        >
          <div className="flex flex-col gap-1.5 border-b border-neutral-700 p-2">
            <SyncStatusBadge />
            <UpdateStatusBadge />
          </div>
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
          {onTabChange && (
            <button
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
              onClick={() => { setMenuOpen(false); onTabChange('backup'); }}
            >
              <Database size={14} aria-hidden="true" />
              Kopia zapasowa
            </button>
          )}
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
