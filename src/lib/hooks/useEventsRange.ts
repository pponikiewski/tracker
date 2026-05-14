import { useEffect, useState } from "react";
import { listEventsInRange, type EventWithResource } from "@/lib/db/queries";
import { useWorkspaceStore } from "@/store/workspace";

interface State {
  events: EventWithResource[];
  loading: boolean;
  error: string | null;
}

export function useEventsRange(fromIso: string, toIso: string): State {
  const [state, setState] = useState<State>({ events: [], loading: false, error: null });
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  useEffect(() => {
    if (!activeWorkspaceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale events when no workspace is active
      setState({ events: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    listEventsInRange(fromIso, toIso, activeWorkspaceId).then(
      (rows) => {
        if (!cancelled) setState({ events: rows, loading: false, error: null });
      },
      (e: unknown) => {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          }));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fromIso, toIso, activeWorkspaceId]);

  return state;
}
