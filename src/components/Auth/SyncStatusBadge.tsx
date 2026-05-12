import { useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { SyncStatusModal } from './SyncStatusModal';

// Req 10.8: priority order — offline > syncing > error > pending > synced
export function SyncStatusBadge() {
  const state = useAuthStore((s) => s.state);
  const status = useAuthStore((s) => s.syncStatus);
  const pending = useAuthStore((s) => s.pendingCount);
  const lastSyncAt = useAuthStore((s) => s.lastSyncAt);
  const [open, setOpen] = useState(false);

  // Req 10.1: hide when not authed
  if (state.kind !== 'authed') return null;

  let label: string;
  let cls = 'text-xs px-2 py-1 rounded border cursor-pointer';

  // Priority 1: offline (overrides everything)
  if (status.kind === 'offline') {
    label = '⏸ Offline';
    cls += ' border-neutral-500 text-neutral-400';
  }
  // Priority 2: syncing (initial-pull counts as syncing)
  else if (status.kind === 'syncing' || status.kind === 'initial-pull') {
    label = status.kind === 'initial-pull' ? 'Syncing initial…' : 'Syncing…';
    cls += ' border-amber-500 text-amber-400';
  }
  // Priority 3: error
  else if (status.kind === 'error') {
    label = '⚠ Error';
    cls += ' border-red-500 text-red-400';
  }
  // Priority 4: pending
  else if (pending > 0) {
    label = `● ${pending} pending`;
    cls += ' border-amber-500 text-amber-400';
  }
  // Priority 5: synced (within 60s of last sync)
  // eslint-disable-next-line react-hooks/purity
  else if (lastSyncAt && Date.now() - lastSyncAt < 60_000) {
    label = '✓ Synced';
    cls += ' border-green-600 text-green-500';
  }
  else {
    label = '✓ Synced';
    cls += ' border-neutral-600 text-neutral-400';
  }

  return (
    <>
      <button className={cls} onClick={() => setOpen(true)} aria-label="Sync status">
        {label}
      </button>
      {open && <SyncStatusModal onClose={() => setOpen(false)} />}
    </>
  );
}
