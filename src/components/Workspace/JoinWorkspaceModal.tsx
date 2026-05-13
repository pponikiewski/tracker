import { useRef, useState } from 'react';
import { useWorkspaceStore } from '@/store/workspace';
import { isValidCodeFormat } from '@/lib/workspace/joinCodeService';

interface Props {
  onClose: () => void;
  /** Called after a successful join with the new workspace id. */
  onJoined?: (workspaceId: string) => void;
}

export function JoinWorkspaceModal({ onClose, onJoined }: Props) {
  const joinWorkspaceByCode = useWorkspaceStore((s) => s.joinWorkspaceByCode);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Strip non-digits and cap at 6 chars for quick-entry UX.
    const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (error) setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidCodeFormat(code)) {
      setError('Kod musi składać się z 6 cyfr.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const workspaceId = await joinWorkspaceByCode(code);
      onJoined?.(workspaceId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się dołączyć.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-96 rounded-lg border border-neutral-700 bg-neutral-900 p-6 shadow-2xl">
        <h2 className="mb-4 text-sm font-semibold text-neutral-100">Dołącz do workspace</h2>
        <p className="mb-4 text-xs text-neutral-400">
          Wpisz 6-cyfrowy kod otrzymany od właściciela workspace.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            ref={inputRef}
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoFocus
            value={code}
            onChange={handleChange}
            placeholder="000000"
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-3 text-center font-mono text-2xl tracking-[0.4em] text-neutral-100 placeholder-neutral-600 focus:border-blue-500 focus:outline-none"
            aria-label="Kod workspace"
          />
          {error && (
            <p className="text-xs text-red-400" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={busy || !isValidCodeFormat(code)}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? '…' : 'Dołącz'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
