import { useState } from 'react';
import { useWorkspaceStore } from '@/store/workspace';

interface WorkspaceCreateModalProps {
  onClose: () => void;
}

function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 1) return 'Nazwa workspace nie może być pusta.';
  if (trimmed.length > 80) return 'Nazwa workspace może mieć maksymalnie 80 znaków.';
  return null;
}

export function WorkspaceCreateModal({ onClose }: WorkspaceCreateModalProps) {
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    if (nameError) setNameError(validateName(e.target.value));
  };

  const isNameValid = validateName(name) === null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateName(name);
    if (err) {
      setNameError(err);
      return;
    }
    setSubmitError(null);
    setBusy(true);
    try {
      await createWorkspace(name);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Nieznany błąd');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-6 w-96 shadow-2xl">
        <h2 className="text-sm font-medium text-neutral-100 mb-5">Nowy workspace</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <input
              type="text"
              placeholder="Nazwa workspace"
              value={name}
              onChange={handleNameChange}
              maxLength={100}
              className={`w-full bg-neutral-800 border rounded px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none transition-colors ${
                nameError
                  ? 'border-red-500 focus:border-red-400'
                  : 'border-neutral-700 focus:border-blue-500'
              }`}
              autoFocus
              autoComplete="off"
            />
            {nameError && (
              <p className="text-red-400 text-xs mt-1" role="alert">
                {nameError}
              </p>
            )}
          </div>
          {submitError && (
            <p className="text-red-400 text-xs" role="alert">
              {submitError}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs border border-neutral-700 text-neutral-400 rounded hover:bg-neutral-800 hover:text-neutral-200 transition-colors">
              Anuluj
            </button>
            <button
              type="submit"
              disabled={busy || !isNameValid}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {busy ? '…' : 'Utwórz'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
