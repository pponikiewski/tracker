import { lazy, Suspense, useEffect, useState } from "react";
import { AuthGate } from "@/components/Auth/AuthGate";
import { ProjectsView } from "./components/ProjectsView";

const DashboardView = lazy(() =>
  import("./components/Dashboard/DashboardView").then((m) => ({ default: m.DashboardView })),
);

type Tab = "projects" | "dashboard";

function App() {
  const [tab, setTab] = useState<Tab>("projects");

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "1") {
        e.preventDefault();
        setTab("projects");
      } else if (e.key === "2") {
        e.preventDefault();
        setTab("dashboard");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full flex-col bg-neutral-950">
      <nav className="flex shrink-0 items-center gap-1 border-b border-neutral-800 bg-neutral-900 px-3 py-1.5">
        <span className="mr-3 text-xs font-semibold tracking-tight text-neutral-100">
          tracker
        </span>
        <TabButton active={tab === "projects"} onClick={() => setTab("projects")} hint="Ctrl+1">
          Projekty
        </TabButton>
        <TabButton active={tab === "dashboard"} onClick={() => setTab("dashboard")} hint="Ctrl+2">
          Dashboard
        </TabButton>
        <div className="ml-auto flex items-center gap-2">
          <AuthGate />
        </div>
      </nav>
      <div className="flex-1 overflow-hidden">
        {tab === "projects" ? (
          <ProjectsView />
        ) : (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                Ładowanie dashboardu…
              </div>
            }
          >
            <DashboardView />
          </Suspense>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  hint,
  children,
}: {
  active: boolean;
  onClick: () => void;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={`rounded px-3 py-1 text-xs transition-colors ${
        active
          ? "bg-blue-600 text-white"
          : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}

export default App;
