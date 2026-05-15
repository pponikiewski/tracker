import { ActivityLogPanel } from "@/components/Dashboard/ActivityLogPanel";

export function ActivityLogView() {
  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <header className="shrink-0 border-b border-neutral-800 px-4 py-3">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-100">Logi zdarzen</h1>
        <p className="mt-1 text-xs text-neutral-500">
          Krotki zapis tego, kto i kiedy zmienial projekty, czas, workspace i przypisania.
        </p>
      </header>

      <main className="flex-1 overflow-auto p-4">
        <ActivityLogPanel />
      </main>
    </div>
  );
}
