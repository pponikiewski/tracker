import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { useAuthStore } from "@/store/auth";
import { startWorker, stopWorker, tick } from "@/lib/sync/worker";

void useAuthStore.getState().init();

// Req 15.1, 15.2: start worker on authed transition, stop on non-authed
useAuthStore.subscribe((s, prev) => {
  if (s.state.kind === 'authed' && prev.state.kind !== 'authed') {
    startWorker();
    void tick();
  } else if (s.state.kind !== 'authed' && prev.state.kind === 'authed') {
    stopWorker();
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
