import { useState, useEffect, useCallback } from 'react';
import { useWorkspaceStore } from '@/store/workspace';
import { useAuthStore } from '@/store/auth';
import type { WorkspaceMembership, Invite } from '@/lib/db/types';

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

function validateEmail(email: string): string | null {
  if (!email.includes('@') || email.length > 254) return 'Podaj prawidłowy adres email.';
  return null;
}

export function WorkspaceSettingsPanel({ workspaceId, onClose }: WorkspaceSettingsPanelProps) {
  const authState = useAuthStore((s) => s.state);
  const currentUserId = authState.kind === 'authed' ? authState.user.id : null;

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const memberships = useWorkspaceStore((s) => s.memberships);
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const removeMember = useWorkspaceStore((s) => s.removeMember);
  const createInvite = useWorkspaceStore((s) => s.createInvite);
  const cancelInvite = useWorkspaceStore((s) => s.cancelInvite);
  const listInvites = useWorkspaceStore((s) => s.listInvites);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);

  const workspace = workspaces.find((w) => w.id === workspaceId) ?? null;

  // Determine if current user is owner
  const isOwner =
    currentUserId !== null &&
    memberships.some(
      (m) =>
        m.workspace_id === workspaceId &&
        m.user_id === currentUserId &&
        m.role === 'owner',
    );

  // Members for this workspace
  const workspaceMembers: WorkspaceMembership[] = memberships.filter(
    (m) => m.workspace_id === workspaceId,
  );

  // ---- Name section state ----
  const [name, setName] = useState(workspace?.name ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameSuccess, setNameSuccess] = useState(false);
  const [nameSubmitError, setNameSubmitError] = useState<string | null>(null);

  // ---- Invites state ----
  const [invites, setInvites] = useState<Invite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteEmailError, setInviteEmailError] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  // ---- Member remove state ----
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // ---- Cancel invite state ----
  const [cancellingInviteId, setCancellingInviteId] = useState<string | null>(null);

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

  // Load invites for owner
  const loadInvites = useCallback(async () => {
    if (!isOwner) return;
    setInvitesLoading(true);
    try {
      const data = await listInvites(workspaceId);
      setInvites(data);
    } catch {
      // silently ignore
    } finally {
      setInvitesLoading(false);
    }
  }, [isOwner, listInvites, workspaceId]);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    (async () => {
      setInvitesLoading(true);
      try {
        const data = await listInvites(workspaceId);
        if (!cancelled) setInvites(data);
      } catch {
        // silently ignore
      } finally {
        if (!cancelled) setInvitesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, listInvites, workspaceId]);

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

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateEmail(inviteEmail);
    if (err) {
      setInviteEmailError(err);
      return;
    }
    setInviteError(null);
    setInviteLink(null);
    setInviteBusy(true);
    try {
      const invite = await createInvite(workspaceId, inviteEmail);
      const link = `${window.location.origin}/invite/${invite.token}`;
      setInviteLink(link);
      setInviteEmail('');
      setInviteEmailError(null);
      await loadInvites();
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : 'Nieznany błąd');
    } finally {
      setInviteBusy(false);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    setCancellingInviteId(inviteId);
    try {
      await cancelInvite(inviteId);
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } catch {
      // silently ignore
    } finally {
      setCancellingInviteId(null);
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

  const formatExpiry = (isoDate: string) => {
    try {
      return new Date(isoDate).toLocaleDateString('pl-PL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoDate;
    }
  };

  const roleLabel = (role: 'owner' | 'member') =>
    role === 'owner' ? 'Właściciel' : 'Członek';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-end z-50">
      <div className="bg-neutral-900 border-l border-neutral-700 h-full w-full max-w-md shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-700 shrink-0">
          <h2 className="text-sm font-medium text-neutral-100">
            Ustawienia workspace
          </h2>
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
                {nameSuccess && (
                  <p className="text-green-400 text-xs">Zapisano.</p>
                )}
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
            ) : (
              <ul className="space-y-1">
                {workspaceMembers.map((m) => (
                  <li
                    key={m.user_id}
                    className="flex items-center justify-between bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-neutral-200 truncate">
                        {m.user_id}
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
                ))}
              </ul>
            )}
          </section>

          {/* ---- Pending invites (owner only) ---- */}
          {isOwner && (
            <section>
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
                Oczekujące zaproszenia
              </h3>
              {invitesLoading ? (
                <p className="text-xs text-neutral-500">Ładowanie…</p>
              ) : invites.length === 0 ? (
                <p className="text-xs text-neutral-500">Brak oczekujących zaproszeń.</p>
              ) : (
                <ul className="space-y-1">
                  {invites.map((invite) => (
                    <li
                      key={invite.id}
                      className="flex items-center justify-between bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs text-neutral-200 truncate">
                          {invite.invited_email}
                        </p>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          Wygasa: {formatExpiry(invite.expires_at)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCancelInvite(invite.id)}
                        disabled={cancellingInviteId === invite.id}
                        className="ml-2 text-xs text-neutral-400 hover:text-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                      >
                        {cancellingInviteId === invite.id ? '…' : 'Anuluj'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* ---- Invite form (owner only) ---- */}
          {isOwner && (
            <section>
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
                Zaproś użytkownika
              </h3>
              <form onSubmit={handleInvite} className="space-y-2">
                <div>
                  <input
                    type="email"
                    placeholder="Adres email"
                    value={inviteEmail}
                    onChange={(e) => {
                      setInviteEmail(e.target.value);
                      if (inviteEmailError) setInviteEmailError(validateEmail(e.target.value));
                    }}
                    onBlur={() => setInviteEmailError(validateEmail(inviteEmail))}
                    className={`w-full bg-neutral-800 border rounded px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none transition-colors ${
                      inviteEmailError
                        ? 'border-red-500 focus:border-red-400'
                        : 'border-neutral-700 focus:border-blue-500'
                    }`}
                    autoComplete="off"
                  />
                  {inviteEmailError && (
                    <p className="text-red-400 text-xs mt-1" role="alert">
                      {inviteEmailError}
                    </p>
                  )}
                </div>
                {inviteError && (
                  <p className="text-red-400 text-xs" role="alert">
                    {inviteError}
                  </p>
                )}
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={inviteBusy || inviteEmail.trim() === ''}
                    className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {inviteBusy ? '…' : 'Zaproś'}
                  </button>
                </div>
              </form>
              {inviteLink && (
                <div className="mt-3 bg-neutral-800 border border-neutral-700 rounded px-3 py-2">
                  <p className="text-xs text-neutral-400 mb-1">Link do zaproszenia:</p>
                  <p className="text-xs text-blue-400 break-all select-all">{inviteLink}</p>
                </div>
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
