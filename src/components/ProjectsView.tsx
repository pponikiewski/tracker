import { useEffect, useState } from "react";
import { useProjects } from "@/store/projects";
import { TreeView } from "./Tree/TreeView";
import { ContextMenu, type MenuEntry } from "./ContextMenu";
import { PromptModal } from "./PromptModal";
import { ColorPickerModal } from "./ColorPickerModal";
import { LogWorkModal } from "./LogWorkModal";
import { defaultChildType, type Resource, type ResourceType } from "@/lib/db/types";

const TYPE_LABEL: Record<ResourceType, string> = {
  project: "Projekt",
  stage: "Etap",
  substage: "Podetap",
  task: "Zadanie",
};

interface MenuState {
  x: number;
  y: number;
  targetId: string | null;
}

interface PromptState {
  title: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
}

export function ProjectsView() {
  const {
    resources,
    tree,
    expandedIds,
    loading,
    error,
    refresh,
    toggleExpanded,
    addProject,
    addChild,
    changeColor,
    deleteSubtree,
    liftAndDelete,
    detachAsProjects,
    logTime,
  } = useProjects();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [colorTargetId, setColorTargetId] = useState<string | null>(null);
  const [logWorkResource, setLogWorkResource] = useState<Resource | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Block native context menu globally on this view.
  useEffect(() => {
    const onCtx = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", onCtx);
    return () => document.removeEventListener("contextmenu", onCtx);
  }, []);

  const findResource = (id: string): Resource | undefined =>
    resources.find((r) => r.id === id);

  const handleContextEmpty = (e: React.MouseEvent) => {
    setMenu({ x: e.clientX, y: e.clientY, targetId: null });
  };

  const handleContextNode = (e: React.MouseEvent, id: string) => {
    setSelectedId(id);
    setMenu({ x: e.clientX, y: e.clientY, targetId: id });
  };

  const openNewProjectPrompt = () => {
    setPrompt({
      title: "Nowy Projekt",
      placeholder: "Nazwa projektu",
      onConfirm: async (name) => {
        await addProject(name);
        setPrompt(null);
      },
    });
  };

  const openAddChildPrompt = (parentId: string, type: ResourceType) => {
    setPrompt({
      title: `Dodaj ${TYPE_LABEL[type]}`,
      placeholder: `Nazwa: ${TYPE_LABEL[type].toLowerCase()}`,
      onConfirm: async (name) => {
        await addChild(parentId, name, type);
        setPrompt(null);
      },
    });
  };

  const buildMenuItems = (targetId: string | null): MenuEntry[] => {
    if (targetId === null) {
      return [{ label: "Nowy Projekt", onClick: openNewProjectPrompt }];
    }
    const node = findResource(targetId);
    if (!node) return [];

    const items: MenuEntry[] = [];
    items.push({
      label: "Loguj czas...",
      onClick: () => setLogWorkResource(node),
    });
    items.push({ separator: true });

    items.push({
      label: "Zmień kolor...",
      onClick: () => setColorTargetId(node.id),
    });
    if (node.color !== null) {
      items.push({
        label: "Wyczyść kolor (dziedzicz)",
        onClick: () => void changeColor(node.id, null),
      });
    }

    const childType = defaultChildType(node.type);
    if (childType) {
      items.push({ separator: true });
      items.push({
        label: `Dodaj ${TYPE_LABEL[childType]}`,
        onClick: () => openAddChildPrompt(node.id, childType),
      });
      // Shortcut to task from project/stage.
      if (childType !== "task" && (node.type === "project" || node.type === "stage")) {
        items.push({
          label: "Dodaj Zadanie (skrót)",
          onClick: () => openAddChildPrompt(node.id, "task"),
        });
      }
    }

    items.push({ separator: true });

    if (node.type === "project") {
      // Root destructive actions.
      items.push({
        label: "Zostaw podległe jako projekty",
        onClick: () => void detachAsProjects(node.id),
      });
    } else {
      items.push({
        label: "Usuń, przypisz podległe wyżej",
        onClick: () => void liftAndDelete(node.id),
      });
    }
    items.push({
      label: "Usuń wraz z podległymi",
      danger: true,
      onClick: () => void deleteSubtree(node.id),
    });

    return items;
  };

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <span className="text-xs uppercase tracking-wide text-neutral-500">
          Drzewo projektów
        </span>
        <span className="text-xs text-neutral-500">
          {loading ? "Ładowanie..." : `${resources.length} węzłów`}
        </span>
      </header>

      {error && (
        <div className="border-b border-red-900 bg-red-950 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <main className="flex-1 overflow-auto">
        <TreeView
          tree={tree}
          expandedIds={expandedIds}
          selectedId={selectedId}
          onToggle={toggleExpanded}
          onSelect={setSelectedId}
          onContextMenuNode={handleContextNode}
          onContextMenuEmpty={handleContextEmpty}
          onLogWork={(id) => {
            const r = findResource(id);
            if (r) setLogWorkResource(r);
          }}
        />
      </main>

      <footer className="border-t border-neutral-800 px-4 py-1.5 text-[10px] text-neutral-500">
        Prawy klik na drzewie albo pustym obszarze · Faza 1 MVP
      </footer>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenuItems(menu.targetId)}
          onClose={() => setMenu(null)}
        />
      )}

      {prompt && (
        <PromptModal
          title={prompt.title}
          placeholder={prompt.placeholder}
          confirmLabel="Utwórz"
          onConfirm={prompt.onConfirm}
          onCancel={() => setPrompt(null)}
        />
      )}

      {colorTargetId && (
        <ColorPickerModal
          initial={findResource(colorTargetId)?.color ?? null}
          onConfirm={async (color) => {
            await changeColor(colorTargetId, color);
            setColorTargetId(null);
          }}
          onCancel={() => setColorTargetId(null)}
        />
      )}

      {logWorkResource && (
        <LogWorkModal
          resource={logWorkResource}
          onSubmit={async (input) => {
            await logTime({ resourceId: logWorkResource.id, ...input });
            setLogWorkResource(null);
          }}
          onCancel={() => setLogWorkResource(null)}
        />
      )}
    </div>
  );
}
