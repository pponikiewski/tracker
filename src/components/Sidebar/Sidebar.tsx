import { BarChart3, FolderTree, History, Users } from "lucide-react";
import { AuthGate } from "@/components/Auth/AuthGate";
import { SyncStatusBadge } from "@/components/Auth/SyncStatusBadge";
import { WorkspaceSwitcher } from "@/components/Workspace/WorkspaceSwitcher";

export type Tab = "projects" | "dashboard" | "history" | "team";

interface SidebarProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  showTeamTab: boolean;
}

interface NavItem {
  id: Tab;
  label: string;
  hint: string;
  icon: typeof FolderTree;
}

const NAV_ITEMS: NavItem[] = [
  { id: "projects", label: "Projekty", hint: "Ctrl+1", icon: FolderTree },
  { id: "dashboard", label: "Raporty", hint: "Ctrl+2", icon: BarChart3 },
  { id: "history", label: "Historia", hint: "Ctrl+3", icon: History },
  { id: "team", label: "Zespół", hint: "Ctrl+4", icon: Users },
];

export function Sidebar({ tab, onTabChange, showTeamTab }: SidebarProps) {
  const items = NAV_ITEMS.filter((item) => item.id !== "team" || showTeamTab);

  return (
    <aside className="flex w-48 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950 px-3 py-4">
      <div className="flex items-center gap-2 px-1">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-600 text-[11px] font-bold text-white shadow-sm">
          T
        </span>
        <span className="text-sm font-semibold tracking-tight text-neutral-100">tracker</span>
      </div>

      <div className="mt-4">
        <WorkspaceSwitcher />
      </div>

      <nav className="mt-4 flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              title={item.hint}
              onClick={() => onTabChange(item.id)}
              className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                active
                  ? "bg-blue-600 text-white"
                  : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
              }`}
            >
              <Icon size={15} strokeWidth={2} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-neutral-800 pt-3">
        <SyncStatusBadge />
        <AuthGate />
      </div>
    </aside>
  );
}
