import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { useWorkspaceStore } from '@/store/workspace';
import { AuthModal } from '@/components/Auth/AuthModal';
import type { Invite } from '@/lib/db/types';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; invite: Invite; workspaceName: string; inviterEmail: string }
  | { kind: 'success'; workspaceId: string; workspaceName: string };

interface Props {
  token: string;
}

export function InviteAcceptView({ token }: Props) {
  const authState = useAuthStore((s) => s.state);
  const [viewState, setViewState] = useState<ViewState>({ kind: 'loading' });
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const isAuthed = authState.kind === 'authed';

  useEffect(() => {
    if (!supabase) {
      void Promise.resolve().then(() =>
        setViewState({ kind: 'error', message: 'Supabase nie jest skonfigurowany.' }),
      );
      return;
    }

    let cancelled = false;

    async function fetchInvite() {
      setViewState({ kind: 'loading' });

      const { data, error } = await supabase!
        .from('invites')
        .select('*')
        .eq('token', token)
        .single();

      if (cancelled) return;

      if (error || !data) {
        setViewState({ kind: 'error', message: 'Link zaproszenia jest nieprawidłowy lub nie istnieje.' });
        return;
      }

      const invite = data as Invite;

      if (invite.accepted_at !== null) {
        setViewState({ kind: 'error', message: 'To zaproszenie zostało już wykorzystane.' });
        return;
      }

      if (new Date(invite.expires_at) <= new Date()) {
        setViewState({ kind: 'error', message: 'To zaproszenie wygasło.' });
        return;
      }

      // Fetch workspace name
      const { data: wsData } = await supabase!
        .from('workspaces')
        .select('name')
        .eq('id', invite.workspace_id)
        .single();

      if (cancelled) return;

      const workspaceName = (wsData as { name: string } | null)?.name ?? 'Nieznany workspace';

      if (!cancelled) {
        // invited_by is the UUID of the inviting user; display it as identifier
        // since we can't directly query auth.users emails from the client
        setViewState({ kind: 'ready', invite, workspaceName, inviterEmail: invite.invited_by });
      }
    }

    fetchInvite();

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleAccept() {
    if (viewState.kind !== 'ready') return;
    setAccepting(true);
    setAcceptError(null);
    try {
      await useWorkspaceStore.getState().acceptInvite(token);
      setViewState({
        kind: 'success',
        workspaceId: viewState.invite.workspace_id,
        workspaceName: viewState.workspaceName,
      });
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : 'Wystąpił nieznany błąd.');
    } finally {
      setAccepting(false);
    }
  }

  function handleGoToWorkspace() {
    if (viewState.kind !== 'success') return;
    useWorkspaceStore.getState().setActiveWorkspace(viewState.workspaceId);
    // Remove invite token from URL without reloading
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url.toString());
    // Force a page reload to clear the invite view
    window.location.reload();
  }

  return (
    <div className="fixed inset-0 bg-neutral-950 flex items-center justify-center z-40">
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-8 w-full max-w-md shadow-2xl">
        <h1 className="text-lg font-semibold text-neutral-100 mb-6">Zaproszenie do workspace</h1>

        {viewState.kind === 'loading' && (
          <p className="text-sm text-neutral-400">Ładowanie zaproszenia…</p>
        )}

        {viewState.kind === 'error' && (
          <div className="space-y-4">
            <div className="bg-red-950/50 border border-red-800 rounded p-3">
              <p className="text-sm text-red-300" role="alert">{viewState.message}</p>
            </div>
          </div>
        )}

        {viewState.kind === 'ready' && (
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500 w-24 shrink-0">Workspace:</span>
                <span className="text-sm text-neutral-100 font-medium">{viewState.workspaceName}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500 w-24 shrink-0">Zaproszony przez:</span>
                <span className="text-sm text-neutral-300 font-mono text-xs break-all">{viewState.inviterEmail}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500 w-24 shrink-0">Dla:</span>
                <span className="text-sm text-neutral-300">{viewState.invite.invited_email}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500 w-24 shrink-0">Wygasa:</span>
                <span className="text-sm text-neutral-400">
                  {new Date(viewState.invite.expires_at).toLocaleString('pl-PL')}
                </span>
              </div>
            </div>

            {!isAuthed ? (
              <div className="space-y-3">
                <div className="bg-amber-950/50 border border-amber-800 rounded p-3">
                  <p className="text-sm text-amber-300">
                    Zaloguj się aby zaakceptować zaproszenie.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAuthModal(true)}
                  className="w-full px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors"
                >
                  Zaloguj się
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {acceptError && (
                  <div className="bg-red-950/50 border border-red-800 rounded p-3">
                    <p className="text-sm text-red-300" role="alert">{acceptError}</p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleAccept}
                  disabled={accepting}
                  className="w-full px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {accepting ? 'Akceptowanie…' : 'Akceptuj zaproszenie'}
                </button>
              </div>
            )}
          </div>
        )}

        {viewState.kind === 'success' && (
          <div className="space-y-5">
            <div className="bg-green-950/50 border border-green-800 rounded p-3">
              <p className="text-sm text-green-300">
                Zaproszenie zostało zaakceptowane. Dołączyłeś do workspace{' '}
                <span className="font-medium">{viewState.workspaceName}</span>.
              </p>
            </div>
            <button
              type="button"
              onClick={handleGoToWorkspace}
              className="w-full px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors"
            >
              Przejdź do workspace
            </button>
          </div>
        )}
      </div>

      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} />
      )}
    </div>
  );
}

/**
 * Reads invite token from URL search params (?invite=TOKEN or ?token=TOKEN).
 * Returns null if no token is present.
 */
export function getInviteTokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('invite') ?? params.get('token');
}
