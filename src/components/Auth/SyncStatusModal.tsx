import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCcw, Trash2, X } from 'lucide-react';
import { getDb } from '@/lib/db/connection';
import { clearForUser, countPendingForUser, listRecentErrors, resetRetryForUser } from '@/lib/sync/outbox';
import { tick } from '@/lib/sync/worker';
import { useAuthStore } from '@/store/auth';

interface Props {
  onClose: () => void;
}

interface ErrRow {
  id: number;
  entity: string;
  entity_id: string;
  last_error: string | null;
  attempts: number;
}

export function SyncStatusModal({ onClose }: Props) {
  const [errors, setErrors] = useState<ErrRow[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const syncStatus = useAuthStore((s) => s.syncStatus);
  const authState = useAuthStore((s) => s.state);
  const pending = useAuthStore((s) => s.pendingCount);
  const setPendingCount = useAuthStore((s) => s.setPendingCount);
  const userId = authState.kind === 'authed' ? authState.user.id : null;
  const isOffline = syncStatus.kind === 'offline' || syncStatus.kind === 'error';
  const statusLabel = isOffline ? 'Offline' : 'Online';
  const statusDescription =
    syncStatus.kind === 'initial-pull'
      ? 'Pobieranie danych zespołu...'
      : syncStatus.kind === 'syncing'
        ? 'Synchronizacja trwa...'
        : syncStatus.kind === 'offline'
          ? 'Brak połączenia. Zmiany zostaną wysłane, gdy wrócisz online.'
          : syncStatus.kind === 'error'
            ? 'Wystąpił problem z synchronizacją.'
            : 'Synchronizacja działa w tle.';

  const refresh = async () => {
    const db = await getDb();
    setErrors(await listRecentErrors(db, 20, userId));
    setPendingCount(await countPendingForUser(db, userId));
  };

  useEffect(() => {
    getDb()
      .then(async (db) => {
        const [rows, count] = await Promise.all([
          listRecentErrors(db, 20, userId),
          countPendingForUser(db, userId),
        ]);
        setErrors(rows);
        setPendingCount(count);
      })
      .catch(() => {
        /* ignore */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const onRetry = async () => {
    const db = await getDb();
    await resetRetryForUser(db, userId);
    await tick();
    await refresh();
  };

  const onClear = async () => {
    if (
      !confirm(
        'Usunąć oczekujące zapisy online? Dane lokalne zostaną, ale niewysłane zmiany mogą nie dotrzeć do zespołu.',
      )
    ) {
      return;
    }
    const db = await getDb();
    await clearForUser(db, userId);
    setPendingCount(await countPendingForUser(db, userId));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="max-h-[80vh] w-[560px] overflow-auto rounded-lg border border-neutral-700 bg-neutral-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-neutral-100">Status: {statusLabel}</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            aria-label="Zamknij"
            title="Zamknij"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <p className="mb-3 text-xs text-neutral-400">{statusDescription}</p>

        {syncStatus.kind === 'error' && (
          <div className="mb-3 flex gap-2 rounded border border-red-900 bg-red-950 px-3 py-2 text-xs text-red-300">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>{syncStatus.message}</span>
          </div>
        )}

        <div className="mb-4 rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-300">
          {pending > 0
            ? `Oczekujące zmiany do zapisu online: ${pending}.`
            : 'Wszystkie zmiany są zapisane online.'}
        </div>

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500"
          >
            <RefreshCcw size={13} aria-hidden="true" />
            Spróbuj ponownie
          </button>
          <button
            type="button"
            onClick={() => setShowAdvanced((value) => !value)}
            className="rounded border border-neutral-600 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            Zaawansowane
          </button>
        </div>

        {showAdvanced && (
          <div className="mb-4 rounded border border-red-950 bg-red-950/30 p-3">
            <button
              type="button"
              onClick={onClear}
              className="flex items-center gap-1.5 rounded bg-red-700 px-3 py-1 text-xs text-white hover:bg-red-600"
            >
              <Trash2 size={13} aria-hidden="true" />
              Usuń oczekujące zapisy online
            </button>
          </div>
        )}

        {errors.length === 0 ? (
          <p className="text-xs text-neutral-500">Brak błędów synchronizacji.</p>
        ) : (
          <ul className="space-y-1.5">
            {errors.map((e) => (
              <li key={e.id} className="border-l-2 border-red-500 pl-2 text-xs">
                <span className="font-mono text-neutral-300">{e.entity}/{e.entity_id}</span>
                <span className="ml-2 text-neutral-500">(x{e.attempts})</span>
                <span className="ml-2 text-red-400">{e.last_error}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
