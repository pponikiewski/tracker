import { useEffect, useState } from 'react';
import { getDb } from '@/lib/db/connection';
import { listRecentErrors, clearAll, resetRetry, countPending } from '@/lib/sync/outbox';
import { tick } from '@/lib/sync/worker';
import { useAuthStore } from '@/store/auth';

interface Props { onClose: () => void; }

interface ErrRow {
  id: number;
  entity: string;
  entity_id: string;
  last_error: string | null;
  attempts: number;
}

export function SyncStatusModal({ onClose }: Props) {
  const [errors, setErrors] = useState<ErrRow[]>([]);
  const setPendingCount = useAuthStore((s) => s.setPendingCount);

  const refresh = async () => {
    const db = await getDb();
    setErrors(await listRecentErrors(db));
  };

  useEffect(() => {
    getDb()
      .then((db) => listRecentErrors(db))
      .then((rows) => setErrors(rows))
      .catch(() => {/* ignore */});
  }, []);

  // Req 11.3: reset next_retry_at FIRST so rows in backoff window are picked up, THEN tick
  const onRetry = async () => {
    const db = await getDb();
    await resetRetry(db);
    await tick();
    await refresh();
  };

  // Req 11.4, 11.5, 11.6: confirm → clear → update pending count → close
  const onClear = async () => {
    if (!confirm('Clear all pending sync ops? This may cause data loss if items have not been synced.')) {
      return; // Req 11.5: cancel → leave untouched, keep modal open
    }
    const db = await getDb();
    await clearAll(db);
    setPendingCount(await countPending(db));
    onClose(); // Req 11.6: close modal after clear
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-6 w-[560px] max-h-[80vh] overflow-auto shadow-xl">
        <h2 className="text-sm font-semibold text-neutral-100 mb-3">Sync status</h2>
        <div className="flex gap-2 mb-4">
          <button
            onClick={onRetry}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs">
            Retry now
          </button>
          <button
            onClick={onClear}
            className="px-3 py-1 bg-red-700 hover:bg-red-600 text-white rounded text-xs">
            Clear outbox
          </button>
          <button
            onClick={onClose}
            className="ml-auto px-3 py-1 border border-neutral-600 text-neutral-300 rounded text-xs hover:bg-neutral-800">
            Close
          </button>
        </div>
        {errors.length === 0 ? (
          <p className="text-xs text-neutral-500">No sync errors.</p>
        ) : (
          <ul className="space-y-1.5">
            {errors.map((e) => (
              <li key={e.id} className="border-l-2 border-red-500 pl-2 text-xs">
                <span className="text-neutral-300 font-mono">{e.entity}/{e.entity_id}</span>
                <span className="text-neutral-500 ml-2">(×{e.attempts})</span>
                <span className="text-red-400 ml-2">{e.last_error}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
