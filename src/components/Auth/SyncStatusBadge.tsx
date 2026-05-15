import { useState } from 'react';
import { Cloud, CloudOff, TriangleAlert } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { SyncStatusModal } from './SyncStatusModal';

// Keep healthy cloud saves visually quiet; only offline/errors change the badge.
export function SyncStatusBadge() {
  const state = useAuthStore((s) => s.state);
  const status = useAuthStore((s) => s.syncStatus);
  const pending = useAuthStore((s) => s.pendingCount);
  const [open, setOpen] = useState(false);

  if (state.kind !== 'authed') return null;

  let label: string;
  let title: string;
  let Icon: typeof Cloud;
  let cls = 'flex items-center gap-1.5 rounded border px-2 py-1 text-xs cursor-pointer';

  if (status.kind === 'offline') {
    label = 'Offline';
    title = 'Cloud connection is offline';
    Icon = CloudOff;
    cls += ' border-neutral-500 text-neutral-400';
  } else if (status.kind === 'error') {
    label = 'Cloud issue';
    title = status.message;
    Icon = TriangleAlert;
    cls += ' border-red-500 text-red-400';
  } else {
    label = 'Cloud';
    title = pending > 0
      ? `${pending} change${pending === 1 ? '' : 's'} saving in the background`
      : 'Cloud is running in the background';
    Icon = Cloud;
    cls += ' border-neutral-600 text-neutral-400';
  }

  return (
    <>
      <button className={cls} onClick={() => setOpen(true)} aria-label="Cloud status" title={title}>
        <Icon size={13} aria-hidden="true" />
        {label}
      </button>
      {open && <SyncStatusModal onClose={() => setOpen(false)} />}
    </>
  );
}
