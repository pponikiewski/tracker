import { useState } from "react";
import { BarChart3, ChevronLeft, ChevronRight, FolderTree, History, ScrollText, Users } from "lucide-react";
import { AuthGate } from "@/components/Auth/AuthGate";
import { PresenceBar } from "@/components/Presence/PresenceBar";
import { WorkspaceSwitcher } from "@/components/Workspace/WorkspaceSwitcher";
import logoUrl from "@/assets/tracker-logo.svg";

export type Tab = "projects" | "dashboard" | "history" | "activity" | "backup" | "team";

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
  { id: "history", label: "Historia", hint: "Ctrl+2", icon: History },
  { id: "dashboard", label: "Raporty", hint: "Ctrl+3", icon: BarChart3 },
  { id: "activity", label: "Logi zdarzeń", hint: "Ctrl+4", icon: ScrollText },
  { id: "team", label: "Zespół", hint: "Ctrl+5", icon: Users },
];

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem("sidebar-collapsed") === "true";
  } catch {
    return false;
  }
}

export function Sidebar({ tab, onTabChange, showTeamTab }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const items = NAV_ITEMS.filter((item) => item.id !== "team" || showTeamTab);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("sidebar-collapsed", String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-neutral-800 bg-neutral-950 py-3 transition-[width] duration-300 ease-in-out ${
        collapsed ? "w-12" : "w-48"
      }`}
    >
      {/* Header — crossfade between two layouts so no layout shift */}
      <div className="relative mb-3 h-9">
        <div
          className={`absolute inset-0 flex items-center gap-2 px-2 transition-opacity duration-200 ${
            collapsed ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <img src={logoUrl} alt="tracker" className="h-7 w-7 shrink-0 rounded-md shadow-sm" />
          <span className="flex-1 truncate text-sm font-semibold tracking-tight text-neutral-100">
            tracker
          </span>
          <button
            type="button"
            onClick={toggle}
            title="Zwiń sidebar"
            className="shrink-0 rounded-md p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
          >
            <ChevronLeft size={13} />
          </button>
        </div>
        <div
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
            collapsed ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <button
            type="button"
            onClick={toggle}
            title="Rozwiń sidebar"
            className="rounded-md p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/* Workspace */}
      <div className={`px-2 ${collapsed ? "flex justify-center" : ""}`}>
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>

      {/* Nav */}
      <nav className="mt-3 flex flex-col gap-0.5 px-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              title={collapsed ? `${item.label} (${item.hint})` : item.hint}
              onClick={() => onTabChange(item.id)}
              className={`flex w-full items-center rounded-md py-2 text-xs font-medium transition-colors ${
                collapsed ? "justify-center" : "px-2"
              } ${
                active
                  ? "bg-blue-600 text-white"
                  : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
              }`}
            >
              <Icon size={15} strokeWidth={2} className="shrink-0" aria-hidden="true" />
              <span
                className={`overflow-hidden transition-[max-width] duration-300 ease-in-out ${
                  collapsed ? "max-w-0" : "max-w-[8rem]"
                }`}
              >
                <span
                  className={`block whitespace-nowrap pl-2.5 transition-opacity duration-200 ${
                    collapsed ? "opacity-0" : "opacity-100"
                  }`}
                >
                  {item.label}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="mt-auto flex flex-col gap-2 border-t border-neutral-800 px-2 pt-3">
        <div
          className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out ${
            collapsed ? "max-h-0 opacity-0" : "max-h-20 opacity-100"
          }`}
        >
          <PresenceBar />
        </div>
        <AuthGate onTabChange={onTabChange} collapsed={collapsed} />
      </div>
    </aside>
  );
}
