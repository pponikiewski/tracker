import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { useAuthStore } from "@/store/auth";
import { startWorker, stopWorker, tick } from "@/lib/sync/worker";
import { runInitialPull } from "@/lib/sync/pull";

void useAuthStore.getState().init();

// Req 8.1, 15.1, 15.2: run initial pull on first authed transition, then start worker
useAuthStore.subscribe((s, prev) => {
  if (s.state.kind === 'authed' && prev.state.kind !== 'authed') {
    // Req 8.1, 15.1: run initial pull first, then start worker
    void runInitialPull(s.state.user.id).then(() => {
      startWorker();
      void tick();
    });
  } else if (s.state.kind !== 'authed' && prev.state.kind === 'authed') {
    stopWorker();
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
