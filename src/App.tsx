import { lazy, Suspense, useEffect, useState } from "react";
import { AuthGate } from "@/components/Auth/AuthGate";
import { LoginPage } from "@/components/Auth/LoginPage";
import { SyncStatusBadge } from "@/components/Auth/SyncStatusBadge";
import { ProjectsView } from "./components/ProjectsView";
import { WorkspaceSwitcher } from "@/components/Workspace/WorkspaceSwitcher";
import { useAuthStore } from "@/store/auth";
import { useWorkspaceStore } from "@/store/workspace";

const DashboardView = lazy(() =>
  import("./components/Dashboard/DashboardView").then((m) => ({ default: m.DashboardView })),
);

const TeamView = lazy(() =>
  import("./components/Team/TeamView").then((m) => ({ default: m.TeamView })),
);

type Tab = "projects" | "dashboard" | "team";

function App() {
  const [tab, setTab] = useState<Tab>("projects");
  const authState = useAuthStore((s) => s.state);

  // All hooks must be called unconditionally before any early returns.
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const memberships = useWorkspaceStore((s) => s.memberships);
  const activeMemberCount = memberships.filter(
    (m) => m.workspace_id === activeWorkspaceId,
  ).length;
  const showTeamTab = activeMemberCount > 1;

  // If the Team tab becomes hidden while it is active, fall back to Projects.
  useEffect(() => {
    if (tab === "team" && !showTeamTab) {
      setTab("projects");
    }
  }, [tab, showTeamTab]);

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
      } else if (e.key === "3" && showTeamTab) {
        e.preventDefault();
        setTab("team");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showTeamTab]);

  // Show full-screen spinner while Supabase session is being resolved.
  if (authState.kind === "loading") {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-950">
        <span className="text-sm text-neutral-500">Ładowanie…</span>
      </div>
    );
  }

  // Show login page when not authenticated.
  if (authState.kind === "anonymous") {
    return <LoginPage />;
  }

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
        {showTeamTab && (
          <TabButton active={tab === "team"} onClick={() => setTab("team")} hint="Ctrl+3">
            Team
          </TabButton>
        )}
        <div className="ml-auto flex items-center gap-2">
          <WorkspaceSwitcher />
          <SyncStatusBadge />
          <AuthGate />
        </div>
      </nav>
      <div className="flex-1 overflow-hidden">
        {tab === "projects" ? (
          <ProjectsView />
        ) : tab === "team" ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                Ładowanie widoku zespołu…
              </div>
            }
          >
            <TeamView />
          </Suspense>
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
