# Complete Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pozwolić użytkownikowi oznaczyć projekt/etap/zadanie jako zakończone przez menu kontekstowe; zakończone elementy znikają z aktywnego drzewa i pojawiają się w zwiniętej sekcji "Zakończone" na dole widoku.

**Architecture:** Dodajemy kolumnę `completed_at INTEGER` do tabeli `resources` (SQLite migration idempotentna przez `ALTER TABLE ... ADD COLUMN`). `listActiveResources` filtruje `completed_at IS NULL`. Nowy store action `completeSubtree`/`uncompleteSubtree` używa bezpośrednich SQL queries przez `getDb()` (bez nowego polecenia Rust). `ProjectsView` renderuje `CompletedSection` pod głównym drzewem.

**Tech Stack:** TypeScript, React 19, Zustand 5, Tauri 2 (`@tauri-apps/plugin-sql`), Tailwind v4, Vitest

---

## File Map

| Plik | Zmiana |
|------|--------|
| `src/lib/db/schema.ts` | Dodaj `SCHEMA_COMPLETED_SQL` (ALTER TABLE) |
| `src/lib/db/connection.ts` | Dodaj `runCompletedMigration()`, wywołaj w `getDb()` |
| `src/lib/db/types.ts` | `completed_at: number \| null` w `Resource` |
| `src/lib/db/queries.ts` | `listCompletedResources`, `setSubtreeCompleted` |
| `src/store/projects.ts` | `completedResources`, `completedTree`, `completeSubtree`, `uncompleteSubtree`, update `resourceEqual` + `refresh` |
| `src/components/Tree/CompletedSection.tsx` | NOWY — sekcja "Zakończone" z własnym mini-drzewem |
| `src/components/ProjectsView.tsx` | Opcja "Zakończ" w menu kontekstowym, render `CompletedSection` |

---

## Task 1: Schema — kolumna `completed_at`

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/connection.ts`

- [ ] **Step 1: Dodaj stałą migracji do schema.ts**

Na końcu pliku `src/lib/db/schema.ts` dopisz:

```typescript
export const SCHEMA_COMPLETED_SQL = `
ALTER TABLE resources ADD COLUMN completed_at INTEGER;
`;
```

- [ ] **Step 2: Dodaj `runCompletedMigration` do connection.ts**

Odczytaj plik `src/lib/db/connection.ts`. Znajdź eksportowaną funkcję `getDb()` (inicjalizuje DB i wywołuje kolejne migracje). Dodaj nową funkcję **przed** `getDb`:

```typescript
export async function runCompletedMigration(db: Database): Promise<void> {
  if (await hasColumn(db, "resources", "completed_at")) return;
  await db.execute("ALTER TABLE resources ADD COLUMN completed_at INTEGER");
}
```

Następnie wewnątrz `getDb()`, po ostatnim istniejącym wywołaniu migracji fazowej, dodaj wywołanie:

```typescript
await runCompletedMigration(db);
```

- [ ] **Step 3: Uruchom pnpm typecheck — oczekiwane: PASS (brak błędów TS na tym etapie)**

```powershell
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts
git commit -m "feat(complete): add completed_at column migration"
```

---

## Task 2: Types — `completed_at` w `Resource`

**Files:**
- Modify: `src/lib/db/types.ts`
- Modify: `src/store/projects.ts` (tylko `resourceEqual`)

- [ ] **Step 1: Napisz failing test — `completed_at` istnieje w Resource**

W pliku `src/lib/db/__tests__/types.test.ts` (stwórz jeśli nie istnieje):

```typescript
import { describe, it, expect } from "vitest";
import type { Resource } from "@/lib/db/types";

describe("Resource type", () => {
  it("has completed_at field", () => {
    const r: Resource = {
      id: "x",
      workspace_id: "w",
      parent_id: null,
      name: "test",
      type: "project",
      color: null,
      path: "x",
      cached_minutes: 0,
      created_at: 0,
      updated_at: 0,
      deleted_at: null,
      completed_at: null,
    };
    expect(r.completed_at).toBeNull();
  });

  it("completed_at accepts a timestamp", () => {
    const r: Resource = {
      id: "x",
      workspace_id: "w",
      parent_id: null,
      name: "test",
      type: "project",
      color: null,
      path: "x",
      cached_minutes: 0,
      created_at: 0,
      updated_at: 0,
      deleted_at: null,
      completed_at: 1716220800000,
    };
    expect(r.completed_at).toBe(1716220800000);
  });
});
```

- [ ] **Step 2: Uruchom test — oczekiwane: FAIL (brak pola `completed_at`)**

```powershell
pnpm test src/lib/db/__tests__/types.test.ts
```

- [ ] **Step 3: Dodaj `completed_at` do interfejsu `Resource` w types.ts**

W `src/lib/db/types.ts`, w interface `Resource`, po linii `deleted_at: number | null;` dodaj:

```typescript
completed_at: number | null;
```

- [ ] **Step 4: Zaktualizuj `resourceEqual` w store/projects.ts**

W `src/store/projects.ts`, w funkcji `resourceEqual`, po sprawdzeniu `a.deleted_at === b.deleted_at` dodaj:

```typescript
    a.completed_at === b.completed_at
```

- [ ] **Step 5: Uruchom testy — oczekiwane: PASS**

```powershell
pnpm test src/lib/db/__tests__/types.test.ts
```

- [ ] **Step 6: typecheck**

```powershell
pnpm typecheck
```

Oczekiwane błędy TS z powodu brakującego pola w miejscach, gdzie `Resource` jest konstruowany ręcznie (np. optimistic objects w `projects.ts`). Napraw każde miejsce dodając `completed_at: null`.

Konkretnie w `store/projects.ts`, każdy `optimistic: Resource = { ... }` w `addProject` i `addChild` musi mieć:
```typescript
completed_at: null,
```

- [ ] **Step 7: typecheck ponownie — oczekiwane: PASS**

```powershell
pnpm typecheck
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/db/types.ts src/lib/db/__tests__/types.test.ts src/store/projects.ts
git commit -m "feat(complete): add completed_at to Resource type"
```

---

## Task 3: Queries — `listCompletedResources` + `setSubtreeCompleted`

**Files:**
- Modify: `src/lib/db/queries.ts`

- [ ] **Step 1: Zaktualizuj `listActiveResources` — filtruj completed**

W `src/lib/db/queries.ts`, znajdź `listActiveResources`. Zmień query tak aby wykluczała zakończone elementy:

```typescript
export async function listActiveResources(workspaceId: string): Promise<Resource[]> {
  const db = await getDb();
  return db.select<Resource[]>(
    `SELECT * FROM resources
     WHERE workspace_id = $1 AND deleted_at IS NULL AND completed_at IS NULL
     ORDER BY path, name ASC, created_at ASC`,
    [workspaceId],
  );
}
```

- [ ] **Step 2: Dodaj `listCompletedResources`**

Po `listActiveResources` dodaj:

```typescript
export async function listCompletedResources(workspaceId: string): Promise<Resource[]> {
  const db = await getDb();
  return db.select<Resource[]>(
    `SELECT * FROM resources
     WHERE workspace_id = $1 AND deleted_at IS NULL AND completed_at IS NOT NULL
     ORDER BY completed_at DESC, path ASC`,
    [workspaceId],
  );
}
```

- [ ] **Step 3: Dodaj `setSubtreeCompleted`**

```typescript
export async function setSubtreeCompleted(id: string, completed: boolean): Promise<void> {
  const db = await getDb();
  const rows = await db.select<Array<{ path: string }>>(
    "SELECT path FROM resources WHERE id = $1 LIMIT 1",
    [id],
  );
  if (rows.length === 0) return;
  const path = rows[0]!.path;
  const ts = completed ? Date.now() : null;
  const now = Date.now();
  await db.execute(
    `UPDATE resources
     SET completed_at = $1, updated_at = $2
     WHERE (path = $3 OR path LIKE $4) AND deleted_at IS NULL`,
    [ts, now, path, `${path}/%`],
  );
}
```

- [ ] **Step 4: typecheck**

```powershell
pnpm typecheck
```

Oczekiwane: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/queries.ts
git commit -m "feat(complete): add listCompletedResources and setSubtreeCompleted queries"
```

---

## Task 4: Store — `completeSubtree` + `uncompleteSubtree`

**Files:**
- Modify: `src/store/projects.ts`

- [ ] **Step 1: Dodaj import nowych queries**

W `src/store/projects.ts`, w bloku importu z `@/lib/db/queries`, dopisz `listCompletedResources` i `setSubtreeCompleted`:

```typescript
import {
  createEvent,
  createResource,
  deleteEvent,
  detachChildrenAsProjects,
  getEvent,
  getResource,
  liftChildrenAndDelete,
  listActiveResources,
  listCompletedResources,
  listResourcesByIds,
  moveResource,
  renameResource,
  setResourceColor,
  setSubtreeCompleted,
  softDeleteSubtree,
  updateEvent,
  type CreateEventInput,
  type UpdateEventInput,
} from "@/lib/db/queries";
```

- [ ] **Step 2: Rozszerz `ProjectsState` interface**

W `interface ProjectsState`, dopisz pola i akcje:

```typescript
  completedResources: Resource[];
  completedTree: ResourceNode[];

  completeSubtree: (id: string) => Promise<void>;
  uncompleteSubtree: (id: string) => Promise<void>;
```

- [ ] **Step 3: Dodaj initial state**

W `create<ProjectsState>((set, get) => ({`, po `error: null,` dopisz:

```typescript
  completedResources: [],
  completedTree: [],
```

- [ ] **Step 4: Zaktualizuj `refresh` — ładuj też completed**

W akcji `refresh`, po linii `set((state) => ({ resources: reused, tree: buildTree(reused, state.tree), loading: false }));`, zastąp tę linię:

```typescript
      const nextCompleted = await listCompletedResources(activeWorkspaceId);
      set((state) => ({
        resources: reused,
        tree: buildTree(reused, state.tree),
        completedResources: nextCompleted,
        completedTree: buildTree(nextCompleted, state.completedTree),
        loading: false,
      }));
```

- [ ] **Step 5: Dodaj akcje `completeSubtree` i `uncompleteSubtree`**

Po akcji `detachAsProjects`, przed `logTime`, dopisz:

```typescript
  completeSubtree: async (id) => {
    await setSubtreeCompleted(id, true);
    await get().refresh({ showLoading: false });
  },

  uncompleteSubtree: async (id) => {
    await setSubtreeCompleted(id, false);
    await get().refresh({ showLoading: false });
  },
```

- [ ] **Step 6: typecheck**

```powershell
pnpm typecheck
```

Oczekiwane: PASS

- [ ] **Step 7: Commit**

```bash
git add src/store/projects.ts
git commit -m "feat(complete): add completeSubtree/uncompleteSubtree to projects store"
```

---

## Task 5: UI — `CompletedSection` component

**Files:**
- Create: `src/components/Tree/CompletedSection.tsx`

- [ ] **Step 1: Stwórz komponent**

```typescript
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ResourceNode } from "@/lib/db/types";
import { formatMinutes } from "@/lib/utils/time";

interface Props {
  tree: ResourceNode[];
  onUnomplete: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
}

function CompletedNode({
  node,
  depth,
  onUnomplete,
  onContextMenu,
}: {
  node: ResourceNode;
  depth: number;
  onUnomplete: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        className="group flex cursor-default items-center gap-1 py-1 pr-2 text-sm text-neutral-500 hover:bg-neutral-800/40 hover:text-neutral-400"
        style={{ paddingLeft: 8 + depth * 16 }}
        onContextMenu={(e) => onContextMenu(e, node.id)}
      >
        <span
          className={`flex h-4 w-4 items-center justify-center ${hasChildren ? "" : "invisible"}`}
          aria-hidden="true"
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronRight
            size={11}
            className={`transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </span>

        <span className="flex-1 truncate line-through opacity-60">{node.name}</span>

        {node.cached_minutes > 0 && (
          <span className="ml-2 shrink-0 text-xs tabular-nums opacity-50">
            {formatMinutes(node.cached_minutes)}
          </span>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUnomplete(node.id);
          }}
          title="Wznów"
          className="ml-2 shrink-0 rounded px-1.5 py-0.5 text-xs text-neutral-600 opacity-0 transition-opacity hover:bg-neutral-700 hover:text-neutral-300 group-hover:opacity-100"
        >
          Wznów
        </button>
      </div>

      {expanded &&
        node.children.map((child) => (
          <CompletedNode
            key={child.id}
            node={child}
            depth={depth + 1}
            onUnomplete={onUnomplete}
            onContextMenu={onContextMenu}
          />
        ))}
    </>
  );
}

export function CompletedSection({ tree, onUnomplete, onContextMenu }: Props) {
  const [open, setOpen] = useState(false);

  if (tree.length === 0) return null;

  const count = tree.length;

  return (
    <div className="border-t border-neutral-800/60 mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-neutral-600 hover:text-neutral-400 transition-colors"
      >
        <ChevronRight
          size={11}
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span>Zakończone ({count})</span>
      </button>

      {open && (
        <div>
          {tree.map((node) => (
            <CompletedNode
              key={node.id}
              node={node}
              depth={0}
              onUnomplete={onUnomplete}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

```powershell
pnpm typecheck
```

Oczekiwane: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/Tree/CompletedSection.tsx
git commit -m "feat(complete): add CompletedSection component"
```

---

## Task 6: ProjectsView — integracja

**Files:**
- Modify: `src/components/ProjectsView.tsx`

- [ ] **Step 1: Dodaj import `CompletedSection` i akcji store**

Na górze `src/components/ProjectsView.tsx`, dodaj import:

```typescript
import { CompletedSection } from "./Tree/CompletedSection";
```

- [ ] **Step 2: Pobierz `completedTree`, `completeSubtree`, `uncompleteSubtree` ze store**

W `ProjectsView`, po linii `const detachAsProjects = useProjects((s) => s.detachAsProjects);` dopisz:

```typescript
  const completedTree = useProjects((s) => s.completedTree);
  const completeSubtree = useProjects((s) => s.completeSubtree);
  const uncompleteSubtree = useProjects((s) => s.uncompleteSubtree);
```

- [ ] **Step 3: Dodaj opcję "Zakończ" do menu kontekstowego**

W funkcji `buildMenuItems`, przed ostatnim separatorem (przed `items.push({ separator: true })`), dopisz:

```typescript
    items.push({ separator: true });
    items.push({
      label: "Zakończ",
      onClick: () => void completeSubtree(node.id),
    });
```

Upewnij się że wstawiasz to PRZED separatorem i sekcją "Usuń", żeby "Zakończ" było oddzielone od destrukcyjnych akcji. Konkretnie wstaw po bloku "Dodaj zadanie" a przed `items.push({ separator: true })` który poprzedza "Usuń wszystko".

Zamień ostatni blok od `items.push({ separator: true });` (ten przed "Usuń") na:

```typescript
    items.push({ separator: true });
    items.push({
      label: "Zakończ",
      onClick: () => void completeSubtree(node.id),
    });

    items.push({ separator: true });

    if (node.type === "project") {
      items.push({
        label: `Usuń ${TYPE_LABEL[node.type].toLowerCase()}`,
        onClick: () => void detachAsProjects(node.id),
      });
    } else {
      items.push({
        label: `Usuń ${TYPE_LABEL[node.type].toLowerCase()}`,
        onClick: () => void liftAndDelete(node.id),
      });
    }
    items.push({
      label: "Usuń wszystko (Delete)",
      danger: true,
      onClick: () => void deleteSubtree(node.id),
    });
```

- [ ] **Step 4: Dodaj `CompletedSection` w JSX**

W `return (...)`, znajdź `</main>` (zamykający tag dla głównego scrollowalnego obszaru). Bezpośrednio po `</TreeView>` a przed `</main>` wstaw:

```tsx
        <CompletedSection
          tree={completedTree}
          onUnomplete={(id) => void uncompleteSubtree(id)}
          onContextMenu={handleContextNode}
        />
```

Tak żeby `<main>` wyglądał tak:

```tsx
      <main className="flex-1 overflow-auto">
        <TreeView
          tree={tree}
          onToggle={toggleExpanded}
          onSelect={setSelectedId}
          onContextMenu={handleContextNode}
          onContextMenuEmpty={handleContextEmpty}
          onDragOverEmpty={handleDragOverEmpty}
          onDropEmpty={handleDropEmpty}
          onLogWork={handleLogWork}
          onStartRename={setRenamingId}
          onCommitRename={handleCommitRename}
          onCancelRename={handleCancelRename}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
        />
        <CompletedSection
          tree={completedTree}
          onUnomplete={(id) => void uncompleteSubtree(id)}
          onContextMenu={handleContextNode}
        />
      </main>
```

- [ ] **Step 5: typecheck**

```powershell
pnpm typecheck
```

Oczekiwane: PASS

- [ ] **Step 6: Uruchom wszystkie testy**

```powershell
pnpm test
```

Oczekiwane: PASS (nowe pole `completed_at: null` może wymagać drobnych poprawek w testach które konstruują `Resource` ręcznie — dodaj pole wszędzie gdzie TS tego wymaga)

- [ ] **Step 7: Commit**

```bash
git add src/components/ProjectsView.tsx
git commit -m "feat(complete): integrate CompletedSection and complete action in context menu"
```

---

## Task 7: Napraw testy które konstruują Resource ręcznie

**Files:**
- Modify: dowolne pliki testowe które mają błędy po dodaniu `completed_at`

- [ ] **Step 1: Uruchom testy i zbierz błędy**

```powershell
pnpm test 2>&1
```

- [ ] **Step 2: Dla każdego błędu "Property 'completed_at' is missing" dodaj `completed_at: null`**

Wzorzec naprawy — wszędzie gdzie jest:

```typescript
const r: Resource = {
  id: "...",
  // ... inne pola
  deleted_at: null,
};
```

Dodaj:

```typescript
  completed_at: null,
```

- [ ] **Step 3: Uruchom testy ponownie — oczekiwane: PASS**

```powershell
pnpm test
```

- [ ] **Step 4: Final typecheck**

```powershell
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(complete): fix tests after adding completed_at field"
```

---

## Self-Review

**Spec coverage:**
- ✅ Oznaczanie jako zakończone przez menu kontekstowe — Task 6, opcja "Zakończ"
- ✅ Zakończone elementy znikają z aktywnego drzewa — Task 3, `listActiveResources` filtruje `completed_at IS NULL`
- ✅ Subtree jest zamykane — Task 3, `setSubtreeCompleted` używa `path LIKE`
- ✅ Osobna sekcja "Zakończone" na dole — Task 5, `CompletedSection`
- ✅ Sekcja zwinięta domyślnie — Task 5, `useState(false)` dla `open`
- ✅ Przycisk "Wznów" — Task 5, `CompletedNode` → `onUnomplete`
- ✅ Liczba zakończonych widoczna w nagłówku sekcji — Task 5, `Zakończone ({count})`

**Placeholder scan:** Brak TBD/TODO/fill-in. Wszystkie kroki mają kod.

**Type consistency:** `completed_at: number | null` użyte konsekwentnie we wszystkich miejscach. `setSubtreeCompleted(id, true/false)` → `completeSubtree`/`uncompleteSubtree` → `CompletedSection.onUnomplete`.
