import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { LoginPage } from "@/components/Auth/LoginPage";
import { Sidebar, type Tab } from "@/components/Sidebar/Sidebar";
import { WorkspaceEmptyState } from "@/components/Workspace/WorkspaceEmptyState";
import { ProjectsView } from "./components/ProjectsView";
import { useAuthStore } from "@/store/auth";
import { useWorkspaceStore } from "@/store/workspace";
import { usePresenceStore } from "@/store/presence";

const DashboardView = lazy(() =>
  import("./components/Dashboard/DashboardView").then((m) => ({ default: m.DashboardView })),
);

const ActivityLogView = lazy(() =>
  import("./components/Activity/ActivityLogView").then((m) => ({ default: m.ActivityLogView })),
);

const BackupView = lazy(() =>
  import("./components/Backup/BackupView").then((m) => ({ default: m.BackupView })),
);

const TeamView = lazy(() =>
  import("./components/Team/TeamView").then((m) => ({ default: m.TeamView })),
);

const HistoryView = lazy(() =>
  import("./components/History/HistoryView").then((m) => ({ default: m.HistoryView })),
);

function AppLoadingScreen() {
  return (
    <div className="flex h-full items-center justify-center bg-neutral-950">
      <span className="text-sm text-neutral-500">Ładowanie...</span>
    </div>
  );
}

function App() {
  const [tab, setTab] = useState<Tab>("projects");
  const [hasResolvedInitialWorkspaceState, setHasResolvedInitialWorkspaceState] = useState(false);
  const authState = useAuthStore((s) => s.state);
  const isInitialPull = useAuthStore((s) => s.syncStatus.kind === "initial-pull");

  // All hooks must be called unconditionally before any early returns.
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const previousWorkspaceIdRef = useRef<string | null>(null);
  const workspaceLoading = useWorkspaceStore((s) => s.loading);
  const hasAvailableWorkspaces = useWorkspaceStore((s) => s.userWorkspaces().length > 0);
  const memberships = useWorkspaceStore((s) => s.memberships);
  const activeMemberCount = memberships.filter((m) => m.workspace_id === activeWorkspaceId).length;
  const showTeamTab = activeMemberCount > 1;
  const showTeamNavItem = showTeamTab || tab === "team";

  useEffect(() => {
    if (authState.kind !== "authed") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the empty-workspace gate when auth leaves the app shell
      setHasResolvedInitialWorkspaceState(false);
      return;
    }
    if (!workspaceLoading && !isInitialPull) {
      setHasResolvedInitialWorkspaceState(true);
    }
  }, [authState.kind, workspaceLoading, isInitialPull]);

  useEffect(() => {
    const previousWorkspaceId = previousWorkspaceIdRef.current;
    previousWorkspaceIdRef.current = activeWorkspaceId;

    if (
      previousWorkspaceId !== null &&
      activeWorkspaceId !== null &&
      previousWorkspaceId !== activeWorkspaceId
    ) {
      setTab("projects");
    }
  }, [activeWorkspaceId]);

  // Faza 7: open/close the per-workspace presence channel as the active
  // workspace (or auth state) changes.
  useEffect(() => {
    if (authState.kind !== "authed" || !activeWorkspaceId) {
      usePresenceStore.getState().stop();
      return;
    }
    usePresenceStore.getState().start(activeWorkspaceId);
    return () => usePresenceStore.getState().stop();
  }, [authState.kind, activeWorkspaceId]);

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
        setTab("history");
      } else if (e.key === "3") {
        e.preventDefault();
        setTab("dashboard");
      } else if (e.key === "4") {
        e.preventDefault();
        setTab("activity");
      } else if (e.key === "5") {
        e.preventDefault();
        setTab("backup");
      } else if (e.key === "6" && showTeamNavItem) {
        e.preventDefault();
        setTab("team");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showTeamNavItem]);

  // Show full-screen spinner while Supabase session is being resolved.
  if (authState.kind === "loading") {
    return <AppLoadingScreen />;
  }

  // Show login page when not authenticated.
  if (authState.kind === "anonymous") {
    return <LoginPage />;
  }

  const isResolvingWorkspace =
    authState.kind === "authed" &&
    ((!hasResolvedInitialWorkspaceState && (workspaceLoading || isInitialPull)) ||
      (hasAvailableWorkspaces && activeWorkspaceId === null));

  if (isResolvingWorkspace) {
    return <AppLoadingScreen />;
  }

  if (hasResolvedInitialWorkspaceState && !hasAvailableWorkspaces && activeWorkspaceId === null) {
    return <WorkspaceEmptyState />;
  }

  return (
    <div className="flex h-full bg-neutral-950 text-neutral-100">
      <Sidebar tab={tab} onTabChange={setTab} showTeamTab={showTeamNavItem} />
      <div className={`flex flex-1 overflow-hidden ${tab !== "projects" && tab !== "dashboard" && tab !== "history" && tab !== "activity" && tab !== "team" ? "justify-center" : ""}`}>
        <div className={`flex h-full w-full flex-col overflow-hidden ${tab !== "projects" && tab !== "dashboard" && tab !== "history" && tab !== "activity" && tab !== "team" ? "max-w-4xl" : ""}`}>
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
        ) : tab === "activity" ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                Ładowanie logów zdarzeń...
              </div>
            }
          >
            <ActivityLogView />
          </Suspense>
        ) : tab === "backup" ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                Ładowanie kopii...
              </div>
            }
          >
            <BackupView />
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
    </div>
  );
}

export default App;
