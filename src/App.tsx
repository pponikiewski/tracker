import { useState } from "react";
import { ProjectsView } from "./components/ProjectsView";
import { DashboardView } from "./components/Dashboard/DashboardView";

type Tab = "projects" | "dashboard";

function App() {
  const [tab, setTab] = useState<Tab>("projects");

  return (
    <div className="flex h-full flex-col bg-neutral-950">
      <nav className="flex shrink-0 items-center gap-1 border-b border-neutral-800 bg-neutral-900 px-3 py-1.5">
        <span className="mr-3 text-xs font-semibold tracking-tight text-neutral-100">
          tracker
        </span>
        <TabButton active={tab === "projects"} onClick={() => setTab("projects")}>
          Projekty
        </TabButton>
        <TabButton active={tab === "dashboard"} onClick={() => setTab("dashboard")}>
          Dashboard
        </TabButton>
      </nav>
      <div className="flex-1 overflow-hidden">
        {tab === "projects" ? <ProjectsView /> : <DashboardView />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
