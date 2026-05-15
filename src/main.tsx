import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { useAuthStore, type AuthState } from "@/store/auth";
import { useWorkspaceStore } from "@/store/workspace";
import { startWorker, stopWorker, tick } from "@/lib/sync/worker";
import { hasRunInitialPull, runInitialPull, resetInitialPullState } from "@/lib/sync/pull";
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

let authTransitionSerial = 0;

async function applyAuthState(state: AuthState, prevState: AuthState | null): Promise<void> {
  if (state.kind === "loading") return;
  if (state.kind === "authed" && prevState?.kind === "authed") {
    if (state.user.id === prevState.user.id) return;
  }

  const serial = ++authTransitionSerial;

  if (state.kind === "authed") {
    const userId = state.user.id;
    const isFirstAuthed = prevState?.kind !== "authed";
    const switched = await handleUserChange(userId);
    if (serial !== authTransitionSerial) return;
    const shouldRunInitialPull = (isFirstAuthed || switched) && !hasRunInitialPull(userId);

    if (shouldRunInitialPull) {
      useAuthStore.getState().setSyncStatus({ kind: "initial-pull" });
    }

    await useWorkspaceStore.getState().init(userId);
    if (serial !== authTransitionSerial) return;

    if (shouldRunInitialPull) {
      try {
        await runInitialPull(userId);
      } catch (error) {
        useAuthStore.getState().setSyncStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "initial pull failed",
        });
      }
      if (serial !== authTransitionSerial) return;
    }

    if (isFirstAuthed || switched) {
      startWorker();
      void tick();
    }
    return;
  }

  if (prevState?.kind === "authed") {
    stopWorker();
  }
  await useWorkspaceStore.getState().init(null);
}

// Req 8.1, 15.1, 15.2: run initial pull on first authed transition or after
// user switch (so the freshly wiped local SQLite gets re-populated from cloud
// for the new account).
useAuthStore.subscribe((s, prev) => {
  void applyAuthState(s.state, prev.state);
});

void useAuthStore.getState().init();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
