import { useState, useRef } from "react";
import { useWorkspaceStore } from "@/store/workspace";
import { useAuthStore } from "@/store/auth";
import { WorkspaceCreateModal } from "./WorkspaceCreateModal";
import { WorkspaceSettingsPanel } from "./WorkspaceSettingsPanel";
import { JoinWorkspaceModal } from "./JoinWorkspaceModal";

/** Truncate a string to max `n` characters, appending '…' if truncated. */
function truncate(text: string, n: number): string {
  return text.length > n ? text.slice(0, n) + "…" : text;
}

const MAX_NAME_LEN = 50;

interface WorkspaceSwitcherProps {
  collapsed?: boolean;
}

export function WorkspaceSwitcher({ collapsed = false }: WorkspaceSwitcherProps) {
  const authState = useAuthStore((s) => s.state);
  const allWorkspaces = useWorkspaceStore((s) => s.workspaces);
  const memberships = useWorkspaceStore((s) => s.memberships);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);

  // Compute derived values outside the selector to avoid infinite re-render loops
  const currentUserId = authState.kind === "authed" ? authState.user.id : null;
  const currentUserWorkspaceIds = new Set(
    memberships
      .filter((m) => m.deleted_at === null && m.user_id === currentUserId)
      .map((m) => m.workspace_id),
  );
  const workspaces = allWorkspaces
    .filter(
      (w) => w.deleted_at === null && (currentUserId === null || currentUserWorkspaceIds.has(w.id)),
    )
    .sort((a, b) => a.created_at - b.created_at);
  const activeWorkspace = allWorkspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const collapsedBtnRef = useRef<HTMLButtonElement>(null);
  const expandedBtnRef = useRef<HTMLButtonElement>(null);
  const [fixedPos, setFixedPos] = useState({ top: 0, left: 0, width: 0 });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const isAnonymous = authState.kind === "anonymous" || authState.kind === "loading";
  const isAuthed = authState.kind === "authed";


  const displayName = activeWorkspace ? truncate(activeWorkspace.name, MAX_NAME_LEN) : "…";

  const handleSelectWorkspace = async (id: string) => {
    setDropdownOpen(false);
    await setActiveWorkspace(id);
  };

  const handleNewWorkspace = () => {
    setDropdownOpen(false);
    setShowCreateModal(true);
  };

  const handleJoinWorkspace = () => {
    setDropdownOpen(false);
    setShowJoinModal(true);
  };

  const handleSettingsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowSettings(true);
  };

  // Close dropdown when focus leaves the container
  const handleDropdownBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDropdownOpen(false);
    }
  };

  if (collapsed) {
    const initial = activeWorkspace ? activeWorkspace.name.charAt(0).toUpperCase() : "W";
    return (
      <div className="relative" onBlur={handleDropdownBlur}>
        <button
          ref={collapsedBtnRef}
          type="button"
          onClick={() => {
            if (!dropdownOpen && collapsedBtnRef.current) {
              const r = collapsedBtnRef.current.getBoundingClientRect();
              setFixedPos({ top: r.top, left: r.right + 8, width: 200 });
            }
            setDropdownOpen((o) => !o);
          }}
          title={activeWorkspace?.name ?? "Workspace"}
          aria-haspopup="listbox"
          aria-expanded={dropdownOpen}
          className="flex h-7 w-7 items-center justify-center rounded bg-neutral-800 text-xs font-semibold text-neutral-200 transition-colors hover:bg-neutral-700 hover:text-white"
        >
          {initial}
        </button>
        {dropdownOpen && (
          <div
            role="listbox"
            aria-label="Wybierz workspace"
            style={{ top: fixedPos.top, left: fixedPos.left }}
            className="fixed z-50 min-w-[200px] rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl"
          >
            {workspaces.map((ws) => {
              const isActive = ws.id === activeWorkspace?.id;
              return (
                <button
                  key={ws.id}
                  role="option"
                  aria-selected={isActive}
                  type="button"
                  onClick={() => handleSelectWorkspace(ws.id)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-neutral-800 ${
                    isActive ? "text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  <span className="w-3 shrink-0 text-blue-400">{isActive ? "✓" : ""}</span>
                  <span className={`truncate ${isActive ? "font-medium" : ""}`} title={ws.name}>
                    {truncate(ws.name, MAX_NAME_LEN)}
                  </span>
                </button>
              );
            })}
            <div className="my-1 border-t border-neutral-800" />
            {activeWorkspace && (
              <button
                type="button"
                onClick={(e) => { setDropdownOpen(false); handleSettingsClick(e); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
              >
                <span className="w-3 shrink-0 text-neutral-600">⚙</span>
                <span>Ustawienia workspace</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleNewWorkspace}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
            >
              <span className="w-3 shrink-0 text-neutral-600">+</span>
              <span>Nowy workspace</span>
            </button>
            <button
              type="button"
              onClick={handleJoinWorkspace}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
            >
              <span className="w-3 shrink-0 text-neutral-600">#</span>
              <span>Dołącz do workspace…</span>
            </button>
          </div>
        )}
        {showCreateModal && <WorkspaceCreateModal onClose={() => setShowCreateModal(false)} />}
        {showJoinModal && <JoinWorkspaceModal onClose={() => setShowJoinModal(false)} />}
        {showSettings && activeWorkspace && (
          <WorkspaceSettingsPanel
            workspaceId={activeWorkspace.id}
            onClose={() => setShowSettings(false)}
          />
        )}
      </div>
    );
  }

  const openExpandedDropdown = () => {
    if (expandedBtnRef.current) {
      const r = expandedBtnRef.current.getBoundingClientRect();
      setFixedPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setDropdownOpen(true);
  };

  return (
    <>
      {isAnonymous && (
        <div className="px-2 py-1 text-xs text-neutral-400">
          <span className="truncate" title={activeWorkspace?.name}>{displayName}</span>
        </div>
      )}

      {isAuthed && (
        <div className="relative w-full" onBlur={handleDropdownBlur}>
          <button
            ref={expandedBtnRef}
            type="button"
            onClick={() => dropdownOpen ? setDropdownOpen(false) : openExpandedDropdown()}
            className="flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
            aria-haspopup="listbox"
            aria-expanded={dropdownOpen}
            title={activeWorkspace?.name}
          >
            <span className="min-w-0 flex-1 truncate">{displayName}</span>
            <svg
              className={`h-3 w-3 shrink-0 text-neutral-500 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
              viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"
            >
              <path d="M2 4l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {dropdownOpen && (
            <div
              role="listbox"
              aria-label="Wybierz workspace"
              style={{ top: fixedPos.top, left: fixedPos.left, width: fixedPos.width }}
              className="fixed z-50 rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl"
            >
              {workspaces.map((ws) => {
                const isActive = ws.id === activeWorkspace?.id;
                return (
                  <button
                    key={ws.id}
                    role="option"
                    aria-selected={isActive}
                    type="button"
                    onClick={() => handleSelectWorkspace(ws.id)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-neutral-800 ${
                      isActive ? "text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    <span className="w-3 shrink-0 text-blue-400">{isActive ? "✓" : ""}</span>
                    <span className={`truncate ${isActive ? "font-medium" : ""}`} title={ws.name}>
                      {truncate(ws.name, MAX_NAME_LEN)}
                    </span>
                  </button>
                );
              })}
              <div className="my-1 border-t border-neutral-800" />
              {activeWorkspace && (
                <button
                  type="button"
                  onClick={(e) => { setDropdownOpen(false); handleSettingsClick(e); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
                >
                  <span className="w-3 shrink-0 text-neutral-600">⚙</span>
                  <span>Ustawienia workspace</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleNewWorkspace}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
              >
                <span className="w-3 shrink-0 text-neutral-600">+</span>
                <span>Nowy workspace</span>
              </button>
              <button
                type="button"
                onClick={handleJoinWorkspace}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
              >
                <span className="w-3 shrink-0 text-neutral-600">#</span>
                <span>Dołącz do workspace…</span>
              </button>
            </div>
          )}
        </div>
      )}

      {showCreateModal && <WorkspaceCreateModal onClose={() => setShowCreateModal(false)} />}
      {showJoinModal && <JoinWorkspaceModal onClose={() => setShowJoinModal(false)} />}
      {showSettings && activeWorkspace && (
        <WorkspaceSettingsPanel workspaceId={activeWorkspace.id} onClose={() => setShowSettings(false)} />
      )}
    </>
  );
}
