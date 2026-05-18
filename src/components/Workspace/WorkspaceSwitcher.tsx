import { useState } from "react";
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

export function WorkspaceSwitcher() {
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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const isAnonymous = authState.kind === "anonymous" || authState.kind === "loading";
  const isAuthed = authState.kind === "authed";
  const hasMultiple = isAuthed && workspaces.length > 1;

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

  return (
    <>
      {/* ── Anonymous mode: name only, no dropdown ── */}
      {isAnonymous && (
        <div className="flex items-center gap-1 px-2 py-1 text-xs text-neutral-400">
          <span className="max-w-[200px] truncate" title={activeWorkspace?.name}>
            {displayName}
          </span>
        </div>
      )}

      {/* ── Authed, single workspace: name + actions ── */}
      {isAuthed && !hasMultiple && (
        <div className="flex min-w-0 items-center gap-1">
          <span
            className="min-w-0 flex-1 truncate px-2 py-1 text-xs text-neutral-300"
            title={activeWorkspace?.name}
          >
            {displayName}
          </span>
          <button
            type="button"
            onClick={handleJoinWorkspace}
            title="Dołącz do workspace"
            className="shrink-0 rounded px-2 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
          >
            Dołącz
          </button>
          <button
            type="button"
            onClick={handleNewWorkspace}
            title="Nowy workspace"
            className="shrink-0 rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
            aria-label="Nowy workspace"
          >
            +
          </button>
          <button
            type="button"
            onClick={handleSettingsClick}
            title="Ustawienia workspace"
            className="shrink-0 rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
            aria-label="Ustawienia workspace"
          >
            ⚙
          </button>
        </div>
      )}

      {/* ── Authed, multiple workspaces: dropdown ── */}
      {hasMultiple && (
        <div className="relative" onBlur={handleDropdownBlur}>
          <div className="flex min-w-0 items-center gap-1">
            {/* Dropdown trigger */}
            <button
              type="button"
              onClick={() => setDropdownOpen((o) => !o)}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
              title={activeWorkspace?.name}
            >
              <span className="min-w-0 flex-1 truncate">{displayName}</span>
              {/* Chevron */}
              <svg
                className={`h-3 w-3 shrink-0 text-neutral-500 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M2 4l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {/* Settings icon */}
            <button
              type="button"
              onClick={handleSettingsClick}
              title="Ustawienia workspace"
              className="shrink-0 rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
              aria-label="Ustawienia workspace"
            >
              ⚙
            </button>
          </div>

          {/* Dropdown list */}
          {dropdownOpen && (
            <div
              role="listbox"
              aria-label="Wybierz workspace"
              className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl"
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
                    {/* Checkmark for active workspace */}
                    <span className="w-3 shrink-0 text-blue-400">{isActive ? "✓" : ""}</span>
                    <span className={`truncate ${isActive ? "font-medium" : ""}`} title={ws.name}>
                      {truncate(ws.name, MAX_NAME_LEN)}
                    </span>
                  </button>
                );
              })}

              {/* Divider */}
              <div className="my-1 border-t border-neutral-800" />

              {/* New workspace */}
              <button
                type="button"
                onClick={handleNewWorkspace}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
              >
                <span className="w-3 shrink-0 text-neutral-600">+</span>
                <span>Nowy workspace</span>
              </button>

              {/* Join workspace by code */}
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

      {/* WorkspaceCreateModal */}
      {showCreateModal && <WorkspaceCreateModal onClose={() => setShowCreateModal(false)} />}

      {/* JoinWorkspaceModal */}
      {showJoinModal && <JoinWorkspaceModal onClose={() => setShowJoinModal(false)} />}

      {/* WorkspaceSettingsPanel */}
      {showSettings && activeWorkspace && (
        <WorkspaceSettingsPanel
          workspaceId={activeWorkspace.id}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
}
