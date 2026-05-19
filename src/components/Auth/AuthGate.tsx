import { Database, LogOut, Palette, User } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/store/auth';
import { AuthModal } from './AuthModal';
import { SyncStatusBadge } from './SyncStatusBadge';
import { UpdateStatusBadge } from '@/components/Updater/UpdateStatusBadge';
import { ProfileSettingsPanel } from '@/components/Profile/ProfileSettingsPanel';
import { ThemePanel } from '@/components/Theme/ThemePanel';
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
  const [themeOpen, setThemeOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState({ bottom: 0, left: 0, width: 0 });

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

  const openMenu = useCallback(() => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      if (menuPlacement === 'bottom-end') {
        setMenuPos({ bottom: 0, left: r.left, width: 256 });
      } else {
        setMenuPos({ bottom: window.innerHeight - r.top + 8, left: r.left, width: Math.max(r.width, 224) });
      }
    }
    setMenuOpen(true);
  }, [menuPlacement]);

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
          className={`flex h-8 w-full items-center justify-center rounded border border-neutral-700 px-3 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100`}
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
        ref={triggerRef}
        className={`flex h-8 w-full items-center rounded border border-neutral-700 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 ${collapsed ? "justify-center gap-0 px-2" : "gap-2 px-3 text-left"}`}
        onClick={() => menuOpen ? setMenuOpen(false) : openMenu()}
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
          style={
            menuPlacement === 'bottom-end'
              ? { position: 'fixed', top: menuPos.bottom, left: menuPos.left, width: menuPos.width }
              : { position: 'fixed', bottom: menuPos.bottom, left: menuPos.left, width: menuPos.width }
          }
          className="z-50 overflow-hidden rounded border border-neutral-700 bg-neutral-800 shadow-xl"
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
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
            onClick={() => { setMenuOpen(false); setThemeOpen(true); }}
          >
            <Palette size={14} aria-hidden="true" />
            Motyw
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
      {themeOpen && <ThemePanel onClose={() => setThemeOpen(false)} />}
    </div>
  );
}
