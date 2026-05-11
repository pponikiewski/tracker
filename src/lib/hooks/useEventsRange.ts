import { useEffect, useState } from "react";
import { listEventsInRange, type EventWithResource } from "@/lib/db/queries";

interface State {
  events: EventWithResource[];
  loading: boolean;
  error: string | null;
}

export function useEventsRange(fromIso: string, toIso: string): State {
  const [state, setState] = useState<State>({ events: [], loading: false, error: null });

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch with cancel guard is the canonical pattern here
    setState((s) => ({ ...s, loading: true, error: null }));
    listEventsInRange(fromIso, toIso).then(
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
  }, [fromIso, toIso]);

  return state;
}
