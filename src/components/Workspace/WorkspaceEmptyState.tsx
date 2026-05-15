import { useState } from 'react';
import { WorkspaceCreateModal } from './WorkspaceCreateModal';
import { JoinWorkspaceModal } from './JoinWorkspaceModal';
import { AuthGate } from '@/components/Auth/AuthGate';

export function WorkspaceEmptyState() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <nav className="flex shrink-0 items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-3 py-1.5">
        <span className="mr-auto text-xs font-semibold tracking-tight text-neutral-100">
          tracker
        </span>
        <AuthGate menuPlacement="bottom-end" />
      </nav>

      <main className="flex flex-1 items-center justify-center px-6">
        <section className="w-full max-w-md rounded-lg border border-neutral-800 bg-neutral-900 p-6 shadow-xl">
          <h1 className="mb-2 text-base font-semibold text-neutral-100">
            Wybierz workspace
          </h1>
          <p className="mb-5 text-sm text-neutral-400">
            Utwórz własny workspace albo dołącz do zespołu kodem od właściciela.
          </p>

          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
            >
              Stwórz workspace
            </button>
            <button
              type="button"
              onClick={() => setShowJoinModal(true)}
              className="rounded border border-neutral-700 px-4 py-2 text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
            >
              Dołącz do workspace
            </button>
          </div>
        </section>
      </main>

      {showCreateModal && (
        <WorkspaceCreateModal onClose={() => setShowCreateModal(false)} />
      )}

      {showJoinModal && (
        <JoinWorkspaceModal onClose={() => setShowJoinModal(false)} />
      )}
    </div>
  );
}
