import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { useAuthStore } from "@/store/auth";
import { useWorkspaceStore } from "@/store/workspace";
import { startWorker, stopWorker, tick } from "@/lib/sync/worker";
import { runInitialPull, resetInitialPullState } from "@/lib/sync/pull";
import { resetUserScopedData } from "@/lib/db/connection";

// localStorage key remembering which user was last seen on this machine.
// When it changes, we wipe non-local data so User B never sees User A's stuff.
const LAST_USER_KEY = "tracker:lastUserId";

function readLastUserId(): string | null {
  try {
    return localStorage.getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}

function writeLastUserId(userId: string | null): void {
  try {
    if (userId === null) localStorage.removeItem(LAST_USER_KEY);
    else localStorage.setItem(LAST_USER_KEY, userId);
  } catch {
    /* ignore */
  }
}

async function handleUserChange(userId: string | null): Promise<boolean> {
  const prev = readLastUserId();
  // First run ever — don't wipe, just record the current user.
  if (prev === null && userId !== null) {
    writeLastUserId(userId);
    return false;
  }
  // Same user returning — nothing to do.
  if (prev === userId) return false;
  // User actually changed — wipe local state before initing stores.
  let switched = false;
  if (prev !== null && prev !== userId) {
    try {
      await resetUserScopedData();
      resetInitialPullState();
      switched = true;
    } catch (err) {
      console.warn("[auth] resetUserScopedData failed:", err);
    }
  }
  writeLastUserId(userId);
  return switched;
}

void useAuthStore.getState().init();

// Req 2.5, 4.3, 4.4: initialise WorkspaceStore after auth init
{
  const authState = useAuthStore.getState().state;
  if (authState.kind === 'authed') {
    void handleUserChange(authState.user.id).then(() =>
      useWorkspaceStore.getState().init(authState.user.id),
    );
  } else {
    void useWorkspaceStore.getState().init(null);
  }
}

// Req 8.1, 15.1, 15.2: run initial pull on first authed transition or after
// user switch (so the freshly wiped local SQLite gets re-populated from cloud
// for the new account).
useAuthStore.subscribe((s, prev) => {
  if (s.state.kind === 'authed') {
    const userId = s.state.user.id;
    const isFirstAuthed = prev.state.kind !== 'authed';
    void handleUserChange(userId).then(async (switched) => {
      await useWorkspaceStore.getState().init(userId);
      if (isFirstAuthed || switched) {
        await runInitialPull(userId);
        startWorker();
        void tick();
      }
    });
  } else if (s.state.kind === 'anonymous') {
    void useWorkspaceStore.getState().init(null);
    if (prev.state.kind === 'authed') {
      stopWorker();
    }
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
