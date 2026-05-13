import { useState, useEffect } from 'react';
import { useWorkspaceStore } from '@/store/workspace';
import { useAuthStore } from '@/store/auth';
import { useProfileStore } from '@/store/profile';
import { AvatarBadge } from '@/components/Profile/AvatarBadge';
import { JOIN_CODE_TTL_MS, type JoinCode } from '@/lib/workspace/joinCodeService';
import type { WorkspaceMembership } from '@/lib/db/types';

interface WorkspaceSettingsPanelProps {
  workspaceId: string;
  onClose: () => void;
}

function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 1) return 'Nazwa nie może być pusta.';
  if (trimmed.length > 80) return 'Nazwa może mieć maksymalnie 80 znaków.';
  return null;
}

/** Formats milliseconds as `m:ss`. Returns '0:00' for non-positive values. */
function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Groups a 6-digit code as "123 456" for readability. */
function formatCode(code: string): string {
  if (code.length !== 6) return code;
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/** Skeleton block used while profiles are loading. */
function MemberSkeleton() {
  return (
    <li className="flex items-center justify-between bg-neutral-800 border border-neutral-700 rounded px-3 py-2 animate-pulse">
      <div className="flex items-center gap-2 min-w-0">
        <span className="h-7 w-7 rounded-full bg-neutral-700 shrink-0" />
        <span className="h-3 w-28 rounded bg-neutral-700" />
        <span className="h-4 w-14 rounded bg-neutral-700 shrink-0" />
      </div>
    </li>
  );
}

export function WorkspaceSettingsPanel({ workspaceId, onClose }: WorkspaceSettingsPanelProps) {
  const authState = useAuthStore((s) => s.state);
  const currentUserId = authState.kind === 'authed' ? authState.user.id : null;

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const memberships = useWorkspaceStore((s) => s.memberships);
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const removeMember = useWorkspaceStore((s) => s.removeMember);
  const generateJoinCode = useWorkspaceStore((s) => s.generateJoinCode);
  const listActiveJoinCodes = useWorkspaceStore((s) => s.listActiveJoinCodes);
  const revokeJoinCode = useWorkspaceStore((s) => s.revokeJoinCode);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);

  const fetchProfiles = useProfileStore((s) => s.fetchProfiles);
  const getProfile = useProfileStore((s) => s.getProfile);
  const profilesLoading = useProfileStore((s) => s.loading);

  const workspace = workspaces.find((w) => w.id === workspaceId) ?? null;

  const isOwner =
    currentUserId !== null &&
    memberships.some(
      (m) =>
        m.workspace_id === workspaceId &&
        m.user_id === currentUserId &&
        m.role === 'owner',
    );

  const workspaceMembers: WorkspaceMembership[] = memberships.filter(
    (m) => m.workspace_id === workspaceId,
  );

  // ---- Profile loading state ----
  const [profilesFetched, setProfilesFetched] = useState(false);

  // ---- Name section state ----
  const [name, setName] = useState(workspace?.name ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameSuccess, setNameSuccess] = useState(false);
  const [nameSubmitError, setNameSubmitError] = useState<string | null>(null);

  // ---- Join code state ----
  const [activeCode, setActiveCode] = useState<JoinCode | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [msLeft, setMsLeft] = useState<number>(0);

  // ---- Member remove state ----
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // ---- Delete workspace state ----
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Sync name field when workspace changes
  useEffect(() => {
    if (workspace) {
      const n = workspace.name;
      void Promise.resolve().then(() => setName(n));
    }
  }, [workspace]);

  // Fetch profiles for all workspace members when panel opens
  useEffect(() => {
    const memberIds = workspaceMembers.map((m) => m.user_id);
    if (memberIds.length === 0) {
      setProfilesFetched(true);
      return;
    }
    setProfilesFetched(false);
    fetchProfiles(memberIds)
      .catch(() => {
        // Silently ignore — getProfile will return fallback values
      })
      .finally(() => {
        setProfilesFetched(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Load active join code for owner
  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    (async () => {
      try {
        const codes = await listActiveJoinCodes(workspaceId);
        if (cancelled) return;
        setActiveCode(codes[0] ?? null);
      } catch {
        // silently ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, listActiveJoinCodes, workspaceId]);

  // Tick the countdown every second while a code is active
  useEffect(() => {
    if (!activeCode) {
      setMsLeft(0);
      return;
    }
    const expiresMs = Date.parse(activeCode.expires_at);
    const update = () => {
      const left = expiresMs - Date.now();
      setMsLeft(left);
      if (left <= 0) {
        setActiveCode(null);
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [activeCode]);

  // Clear the "copied" flash after a moment
  useEffect(() => {
    if (!codeCopied) return;
    const id = setTimeout(() => setCodeCopied(false), 1500);
    return () => clearTimeout(id);
  }, [codeCopied]);

  // ---- Handlers ----

  const handleNameSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateName(name);
    if (err) {
      setNameError(err);
      return;
    }
    setNameSubmitError(null);
    setNameSuccess(false);
    setNameBusy(true);
    try {
      await renameWorkspace(workspaceId, name);
      setNameSuccess(true);
      setTimeout(() => setNameSuccess(false), 2000);
    } catch (error) {
      setNameSubmitError(error instanceof Error ? error.message : 'Nieznany błąd');
    } finally {
      setNameBusy(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    setRemovingMemberId(userId);
    setRemoveError(null);
    try {
      await removeMember(workspaceId, userId);
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : 'Nieznany błąd');
    } finally {
      setRemovingMemberId(null);
    }
  };

  const handleGenerateCode = async () => {
    setCodeError(null);
    setCodeBusy(true);
    try {
      const code = await generateJoinCode(workspaceId);
      setActiveCode(code);
    } catch (error) {
      setCodeError(error instanceof Error ? error.message : 'Nieznany błąd');
    } finally {
      setCodeBusy(false);
    }
  };

  const handleRevokeCode = async () => {
    if (!activeCode) return;
    try {
      await revokeJoinCode(activeCode.code);
      setActiveCode(null);
    } catch (error) {
      setCodeError(error instanceof Error ? error.message : 'Nieznany błąd');
    }
  };

  const handleCopyCode = async () => {
    if (!activeCode) return;
    try {
      await navigator.clipboard.writeText(activeCode.code);
      setCodeCopied(true);
    } catch {
      // Fallback: select the text (best-effort)
    }
  };

  const handleDeleteWorkspace = async () => {
    const confirmed = window.confirm(
      `Czy na pewno chcesz usunąć workspace "${workspace?.name ?? ''}"? Tej operacji nie można cofnąć.`,
    );
    if (!confirmed) return;
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      await deleteWorkspace(workspaceId);
      onClose();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Nieznany błąd');
      setDeleteBusy(false);
    }
  };

  const roleLabel = (role: 'owner' | 'member') =>
    role === 'owner' ? 'Właściciel' : 'Członek';

  const membersLoading = !profilesFetched || profilesLoading;

  // Total countdown percentage (for progress bar).
  const ttlRatio = Math.max(0, Math.min(1, msLeft / JOIN_CODE_TTL_MS));

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-end z-50">
      <div className="bg-neutral-900 border-l border-neutral-700 h-full w-full max-w-md shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-700 shrink-0">
          <h2 className="text-sm font-medium text-neutral-100">Ustawienia workspace</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-200 transition-colors text-lg leading-none"
            aria-label="Zamknij"
          >
            ✕
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* ---- Name section ---- */}
          <section>
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
              Nazwa workspace
            </h3>
            {isOwner ? (
              <form onSubmit={handleNameSave} className="space-y-2">
                <div>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (nameError) setNameError(validateName(e.target.value));
                    }}
                    onBlur={() => setNameError(validateName(name))}
                    maxLength={100}
                    className={`w-full bg-neutral-800 border rounded px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none transition-colors ${
                      nameError
                        ? 'border-red-500 focus:border-red-400'
                        : 'border-neutral-700 focus:border-blue-500'
                    }`}
                    autoComplete="off"
                  />
                  {nameError && (
                    <p className="text-red-400 text-xs mt-1" role="alert">
                      {nameError}
                    </p>
                  )}
                </div>
                {nameSubmitError && (
                  <p className="text-red-400 text-xs" role="alert">
                    {nameSubmitError}
                  </p>
                )}
                {nameSuccess && <p className="text-green-400 text-xs">Zapisano.</p>}
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={nameBusy || validateName(name) !== null}
                    className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {nameBusy ? '…' : 'Zapisz'}
                  </button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-neutral-200 bg-neutral-800 border border-neutral-700 rounded px-3 py-2">
                {workspace?.name ?? '—'}
              </p>
            )}
          </section>

          {/* ---- Members section ---- */}
          <section>
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
              Członkowie
            </h3>
            {removeError && (
              <p className="text-red-400 text-xs mb-2" role="alert">
                {removeError}
              </p>
            )}
            {workspaceMembers.length === 0 ? (
              <p className="text-xs text-neutral-500">Brak członków.</p>
            ) : membersLoading ? (
              <ul className="space-y-1" aria-busy="true" aria-label="Ładowanie członków…">
                {workspaceMembers.map((m) => (
                  <MemberSkeleton key={m.user_id} />
                ))}
              </ul>
            ) : (
              <ul className="space-y-1">
                {workspaceMembers.map((m) => {
                  const profile = getProfile(m.user_id);
                  return (
                    <li
                      key={m.user_id}
                      className="flex items-center justify-between bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <AvatarBadge
                          userId={m.user_id}
                          displayName={profile.display_name}
                          avatarUrl={profile.avatar_url}
                          size="sm"
                        />
                        <span className="text-xs text-neutral-200 truncate">
                          {profile.display_name}
                        </span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                            m.role === 'owner'
                              ? 'bg-amber-900/50 text-amber-300'
                              : 'bg-neutral-700 text-neutral-400'
                          }`}
                        >
                          {roleLabel(m.role)}
                        </span>
                      </div>
                      {isOwner && m.user_id !== currentUserId && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(m.user_id)}
                          disabled={removingMemberId === m.user_id}
                          className="ml-2 text-xs text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                        >
                          {removingMemberId === m.user_id ? '…' : 'Usuń'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ---- Join code section (owner only) ---- */}
          {isOwner && (
            <section>
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
                Kod dołączenia
              </h3>
              <p className="mb-3 text-xs text-neutral-500">
                Wygeneruj 6-cyfrowy kod, który Twoi współpracownicy mogą wpisać, aby dołączyć
                do tego workspace. Kod jest jednorazowy i wygasa po 5 minutach.
              </p>

              {codeError && (
                <p className="mb-2 text-xs text-red-400" role="alert">
                  {codeError}
                </p>
              )}

              {activeCode ? (
                <div className="space-y-3 rounded border border-neutral-700 bg-neutral-800 p-4">
                  <div className="text-center">
                    <div className="font-mono text-3xl font-bold tracking-[0.3em] text-neutral-100">
                      {formatCode(activeCode.code)}
                    </div>
                    <p className="mt-2 text-xs text-neutral-400">
                      Wygasa za{' '}
                      <span
                        className={`font-mono ${msLeft < 30_000 ? 'text-amber-400' : 'text-neutral-200'}`}
                      >
                        {formatCountdown(msLeft)}
                      </span>
                    </p>
                  </div>

                  {/* Progress bar */}
                  <div className="h-1 w-full overflow-hidden rounded bg-neutral-700">
                    <div
                      className={`h-full transition-all duration-1000 ${
                        msLeft < 30_000 ? 'bg-amber-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${ttlRatio * 100}%` }}
                    />
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="rounded border border-neutral-600 px-3 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
                    >
                      {codeCopied ? 'Skopiowano ✓' : 'Kopiuj kod'}
                    </button>
                    <button
                      type="button"
                      onClick={handleRevokeCode}
                      className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-neutral-200"
                    >
                      Anuluj
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleGenerateCode}
                  disabled={codeBusy}
                  className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {codeBusy ? '…' : 'Generuj kod'}
                </button>
              )}
            </section>
          )}

          {/* ---- Delete workspace (owner only) ---- */}
          {isOwner && (
            <section className="pt-2 border-t border-neutral-700">
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
                Strefa niebezpieczna
              </h3>
              {deleteError && (
                <p className="text-red-400 text-xs mb-2" role="alert">
                  {deleteError}
                </p>
              )}
              <button
                type="button"
                onClick={handleDeleteWorkspace}
                disabled={deleteBusy}
                className="px-3 py-1.5 text-xs bg-red-700 text-white rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {deleteBusy ? '…' : 'Usuń workspace'}
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
