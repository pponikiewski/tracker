import { useEffect, useRef, useState } from 'react';
import { useWorkspaceStore } from '@/store/workspace';
import { useAssignmentStore } from '@/store/assignments';
import { useProfileStore } from '@/store/profile';
import { AvatarBadge } from '@/components/Profile/AvatarBadge';

interface AssignmentPickerProps {
  /** The resource (project / stage / task) being assigned. */
  resourceId: string;
  /** The workspace the resource belongs to. */
  workspaceId: string;
  /** Called when the picker should close (e.g. click-outside or Escape). */
  onClose: () => void;
  /**
   * Optional anchor position for the popover.
   * When omitted the picker renders inline (useful for testing / embedding).
   */
  anchorX?: number;
  anchorY?: number;
}

/**
 * Dropdown/popover that lists all workspace members with checkboxes showing
 * current assignment status. Clicking a checkbox toggles the assignment.
 *
 * Requirements: 5.10, 5.11
 */
export function AssignmentPicker({
  resourceId,
  workspaceId,
  onClose,
  anchorX,
  anchorY,
}: AssignmentPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  // ---- Store selectors ----
  const memberships = useWorkspaceStore((s) => s.memberships);
  const getAssignees = useAssignmentStore((s) => s.getAssignees);
  const assign = useAssignmentStore((s) => s.assign);
  const unassign = useAssignmentStore((s) => s.unassign);
  const fetchProfiles = useProfileStore((s) => s.fetchProfiles);
  const getProfile = useProfileStore((s) => s.getProfile);

  // Members of this workspace only
  const workspaceMembers = memberships.filter((m) => m.workspace_id === workspaceId);

  // Current assignees for this resource
  const assigneeIds = getAssignees(resourceId);

  // Per-row busy state to prevent double-clicks
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // ---- Fetch profiles for all members on mount ----
  useEffect(() => {
    const ids = workspaceMembers.map((m) => m.user_id);
    if (ids.length > 0) {
      fetchProfiles(ids).catch(() => {
        // Silently ignore — getProfile returns fallback values
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // ---- Close on click-outside or Escape ----
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  // ---- Toggle handler ----
  const handleToggle = async (userId: string, currentlyAssigned: boolean) => {
    if (busyIds.has(userId)) return;

    setBusyIds((prev) => new Set(prev).add(userId));
    setError(null);
    try {
      if (currentlyAssigned) {
        await unassign(resourceId, userId, workspaceId);
      } else {
        await assign(resourceId, userId, workspaceId);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  // ---- Positioning ----
  const isPositioned = anchorX !== undefined && anchorY !== undefined;
  const positionStyle: React.CSSProperties = isPositioned
    ? { position: 'fixed', left: anchorX, top: anchorY, zIndex: 50 }
    : {};

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Przypisz członków"
      className="min-w-[220px] rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-2xl"
      style={positionStyle}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-700">
        <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
          Przypisz członków
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-500 hover:text-neutral-200 transition-colors text-sm leading-none"
          aria-label="Zamknij"
        >
          ✕
        </button>
      </div>

      {/* Member list */}
      {workspaceMembers.length === 0 ? (
        <p className="px-3 py-2 text-xs text-neutral-500">Brak członków workspace.</p>
      ) : (
        <ul role="list" className="py-1">
          {workspaceMembers.map((m) => {
            const profile = getProfile(m.user_id);
            const isAssigned = assigneeIds.includes(m.user_id);
            const isBusy = busyIds.has(m.user_id);

            return (
              <li key={m.user_id}>
                <label
                  className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none transition-colors ${
                    isBusy
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-neutral-800'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isAssigned}
                    disabled={isBusy}
                    onChange={() => handleToggle(m.user_id, isAssigned)}
                    className="h-3.5 w-3.5 rounded border-neutral-600 bg-neutral-800 text-blue-500 accent-blue-500 cursor-pointer disabled:cursor-not-allowed"
                    aria-label={`Przypisz ${profile.display_name}`}
                  />
                  <AvatarBadge
                    userId={m.user_id}
                    displayName={profile.display_name}
                    avatarUrl={profile.avatar_url}
                    size="xs"
                  />
                  <span className="flex-1 truncate text-sm text-neutral-200">
                    {profile.display_name}
                  </span>
                  {isBusy && (
                    <span className="text-xs text-neutral-500 shrink-0">…</span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {/* Error message */}
      {error && (
        <p className="px-3 pb-2 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
