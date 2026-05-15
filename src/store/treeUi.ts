import { create } from "zustand";

interface TreeUiState {
  selectedId: string | null;
  renamingId: string | null;
  draggingId: string | null;
  dropTargetId: string | null;
  dimmedIds: Set<string>;

  setSelected: (id: string | null) => void;
  setRenaming: (id: string | null) => void;
  setDragging: (id: string | null) => void;
  setDropTarget: (id: string | null) => void;
  setDimmedIds: (ids: Set<string>) => void;
  resetDrag: () => void;
}

const EMPTY_SET: Set<string> = new Set();

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export const useTreeUiStore = create<TreeUiState>((set, get) => ({
  selectedId: null,
  renamingId: null,
  draggingId: null,
  dropTargetId: null,
  dimmedIds: EMPTY_SET,

  setSelected: (id) => {
    if (get().selectedId !== id) set({ selectedId: id });
  },
  setRenaming: (id) => {
    if (get().renamingId !== id) set({ renamingId: id });
  },
  setDragging: (id) => {
    if (get().draggingId !== id) set({ draggingId: id });
  },
  setDropTarget: (id) => {
    if (get().dropTargetId !== id) set({ dropTargetId: id });
  },
  setDimmedIds: (ids) => {
    if (!setsEqual(get().dimmedIds, ids)) set({ dimmedIds: ids });
  },
  resetDrag: () => {
    const s = get();
    if (s.draggingId !== null || s.dropTargetId !== null) {
      set({ draggingId: null, dropTargetId: null });
    }
  },
}));
