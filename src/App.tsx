import { lazy, Suspense, useEffect, useState } from "react";
import { LoginPage } from "@/components/Auth/LoginPage";
import { Sidebar, type Tab } from "@/components/Sidebar/Sidebar";
import { WorkspaceEmptyState } from "@/components/Workspace/WorkspaceEmptyState";
import { ProjectsView } from "./components/ProjectsView";
import { useAuthStore } from "@/store/auth";
import { useWorkspaceStore } from "@/store/workspace";

const DashboardView = lazy(() =>
  import("./components/Dashboard/DashboardView").then((m) => ({ default: m.DashboardView })),
);

const TeamView = lazy(() =>
  import("./components/Team/TeamView").then((m) => ({ default: m.TeamView })),
);

const HistoryView = lazy(() =>
  import("./components/History/HistoryView").then((m) => ({ default: m.HistoryView })),
);

function App() {
  const [tab, setTab] = useState<Tab>("projects");
  const [hasResolvedInitialWorkspaceState, setHasResolvedInitialWorkspaceState] = useState(false);
  const authState = useAuthStore((s) => s.state);

  // All hooks must be called unconditionally before any early returns.
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaceLoading = useWorkspaceStore((s) => s.loading);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const memberships = useWorkspaceStore((s) => s.memberships);
  const activeMemberCount = memberships.filter((m) => m.workspace_id === activeWorkspaceId).length;
  const showTeamTab = activeMemberCount > 1;

  useEffect(() => {
    if (authState.kind !== "authed") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the empty-workspace gate when auth leaves the app shell
      setHasResolvedInitialWorkspaceState(false);
      return;
    }
    if (!workspaceLoading) {
      setHasResolvedInitialWorkspaceState(true);
    }
  }, [authState.kind, workspaceLoading]);

  // If the Team tab becomes hidden while it is active, fall back to Projects.
  useEffect(() => {
    if (tab === "team" && !showTeamTab) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- tab visibility depends on workspace membership state
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
      } else if (e.key === "3") {
        e.preventDefault();
        setTab("history");
      } else if (e.key === "4" && showTeamTab) {
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
        <span className="text-sm text-neutral-500">Ładowanie...</span>
      </div>
    );
  }

  // Show login page when not authenticated.
  if (authState.kind === "anonymous") {
    return <LoginPage />;
  }

  const visibleWorkspaces = workspaces.filter((w) => w.deleted_at === null);
  if (
    hasResolvedInitialWorkspaceState &&
    visibleWorkspaces.length === 0 &&
    activeWorkspaceId === null
  ) {
    return <WorkspaceEmptyState />;
  }

  return (
    <div className="flex h-full bg-neutral-950 text-neutral-100">
      <Sidebar tab={tab} onTabChange={setTab} showTeamTab={showTeamTab} />
      <div className="flex-1 overflow-hidden">
        {tab === "projects" ? (
          <ProjectsView />
        ) : tab === "history" ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                Ładowanie historii...
              </div>
            }
          >
            <HistoryView />
          </Suspense>
        ) : tab === "team" ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                Ładowanie widoku zespołu...
              </div>
            }
          >
            <TeamView />
          </Suspense>
        ) : (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                Ładowanie dashboardu...
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

export default App;
