import { ActivityLogPanel } from "@/components/Dashboard/ActivityLogPanel";

export function ActivityLogView() {
  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <header className="shrink-0 border-b border-neutral-800 px-4 py-3">
        <div className="w-full max-w-4xl">
          <h1 className="text-lg font-semibold tracking-tight text-neutral-100">Logi zdarzeń</h1>
          <p className="mt-1 text-xs text-neutral-500">
            Krótki zapis tego, kto i kiedy zmieniał projekty, czas, workspace i przypisania.
          </p>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4">
        <ActivityLogPanel />
      </main>
    </div>
  );
}
