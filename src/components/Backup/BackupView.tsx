import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  RefreshCcw,
  ShieldCheck,
  Upload,
  Wrench,
} from "lucide-react";
import { getDb } from "@/lib/db/connection";
import {
  exportBackup,
  repairLocalData,
  restoreBackupFromText,
  runLocalAudit,
} from "@/lib/backup/backupService";
import type { AuditIssue, AuditReport, AuditSeverity } from "@/lib/backup/backupFormat";
import { countPendingForUser } from "@/lib/sync/outbox";
import { useAuthStore } from "@/store/auth";
import { useProjects } from "@/store/projects";
import { useWorkspaceStore } from "@/store/workspace";
import { useAssignmentStore } from "@/store/assignments";
import { useProfileStore } from "@/store/profile";

type BusyState = "export" | "restore" | "audit" | "repair" | null;

function severityClass(severity: AuditSeverity): string {
  switch (severity) {
    case "error":
      return "border-red-900 bg-red-950/40 text-red-200";
    case "warning":
      return "border-amber-900 bg-amber-950/30 text-amber-200";
    case "info":
      return "border-neutral-800 bg-neutral-900 text-neutral-300";
  }
}

function severityLabel(severity: AuditSeverity): string {
  switch (severity) {
    case "error":
      return "Błąd";
    case "warning":
      return "Ostrzeżenie";
    case "info":
      return "Info";
  }
}

function issueCount(report: AuditReport | null, severity: AuditSeverity): number {
  return report?.issues.filter((issue) => issue.severity === severity).length ?? 0;
}

function AuditIssueRow({ issue }: { issue: AuditIssue }) {
  return (
    <li className={`rounded-md border px-3 py-2 text-xs ${severityClass(issue.severity)}`}>
      <div className="flex items-center gap-2">
        {issue.severity === "error" ? (
          <AlertTriangle size={14} aria-hidden="true" />
        ) : issue.severity === "warning" ? (
          <AlertTriangle size={14} aria-hidden="true" />
        ) : (
          <CheckCircle2 size={14} aria-hidden="true" />
        )}
        <span className="font-medium">{severityLabel(issue.severity)}</span>
        <span className="font-mono text-[11px] opacity-70">{issue.code}</span>
        {issue.entity && (
          <span className="ml-auto truncate font-mono text-[11px] opacity-70">
            {issue.entity}/{issue.entity_id}
          </span>
        )}
      </div>
      <p className="mt-1 text-neutral-300">{issue.message}</p>
    </li>
  );
}

export function BackupView() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const authState = useAuthStore((s) => s.state);
  const setPendingCount = useAuthStore((s) => s.setPendingCount);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const userId = authState.kind === "authed" ? authState.user.id : null;

  const refreshAppState = async () => {
    await useWorkspaceStore.getState().refresh();
    await useWorkspaceStore.getState().restoreActiveWorkspace(userId);
    await useProjects.getState().refresh({ showLoading: false });
    const nextWorkspaceId = useWorkspaceStore.getState().activeWorkspaceId;
    if (nextWorkspaceId) {
      await useAssignmentStore.getState().loadAssignments(nextWorkspaceId);
    } else {
      useAssignmentStore.setState({ assignmentsByResource: {} });
    }
    useProfileStore.setState({ profiles: {} });
    const db = await getDb();
    setPendingCount(await countPendingForUser(db, userId));
    window.dispatchEvent(new CustomEvent("tracker:activity-log-changed"));
  };

  const refreshAudit = async () => {
    setBusy("audit");
    setError(null);
    try {
      setAudit(await runLocalAudit());
    } catch (auditError) {
      setError(auditError instanceof Error ? auditError.message : "Nie udało się wykonać audytu.");
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    runLocalAudit()
      .then((report) => {
        if (!cancelled) setAudit(report);
      })
      .catch((auditError: unknown) => {
        if (!cancelled) {
          setError(
            auditError instanceof Error ? auditError.message : "Nie udało się wykonać audytu.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);

  const onExport = async () => {
    setBusy("export");
    setError(null);
    setMessage(null);
    try {
      const path = await exportBackup();
      setMessage(path ? `Zapisano: ${path}` : "Eksport rozpoczęty.");
      setAudit(await runLocalAudit());
    } catch (exportError) {
      setError(
        exportError instanceof Error ? exportError.message : "Nie udało się wyeksportować kopii.",
      );
    } finally {
      setBusy(null);
    }
  };

  const onRestoreClick = () => {
    fileInputRef.current?.click();
  };

  const onRestoreFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!confirm("Przywrócenie kopii zastąpi lokalne dane aplikacji. Kontynuować?")) {
      return;
    }

    setBusy("restore");
    setError(null);
    setMessage(null);
    try {
      const result = await restoreBackupFromText(await file.text());
      await refreshAppState();
      setAudit(result.audit);
      setMessage(`Przywrócono ${result.rowsRestored} wierszy z ${file.name}.`);
    } catch (restoreError) {
      setError(
        restoreError instanceof Error ? restoreError.message : "Nie udało się przywrócić kopii.",
      );
    } finally {
      setBusy(null);
    }
  };

  const onRepair = async () => {
    setBusy("repair");
    setError(null);
    setMessage(null);
    try {
      const result = await repairLocalData();
      await refreshAppState();
      setAudit(result.audit);
      setMessage(
        `Naprawiono: outbox ${result.orphanedOutboxRows + result.localWorkspaceOutboxRows}, przeliczono ${result.resourcesRecalculated} zasobów.`,
      );
    } catch (repairError) {
      setError(
        repairError instanceof Error ? repairError.message : "Nie udało się naprawić danych.",
      );
    } finally {
      setBusy(null);
    }
  };

  const hasIssues = (audit?.issues.length ?? 0) > 0;
  const errorCount = issueCount(audit, "error");
  const warningCount = issueCount(audit, "warning");
  const isBusy = busy !== null;

  return (
    <main className="flex h-full flex-col overflow-hidden bg-neutral-950">
      <header className="border-b border-neutral-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-neutral-900 text-blue-300">
            <Database size={18} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-neutral-100">Kopia i audyt</h1>
            <p className="text-xs text-neutral-500">Lokalna baza, outbox sync i spójność drzewa.</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onExport}
              disabled={isBusy}
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={14} aria-hidden="true" />
              Eksportuj JSON
            </button>
            <button
              type="button"
              onClick={onRestoreClick}
              disabled={isBusy}
              className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Upload size={14} aria-hidden="true" />
              Przywróć
            </button>
            <button
              type="button"
              onClick={() => void refreshAudit()}
              disabled={isBusy}
              className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCcw size={14} aria-hidden="true" />
              Audyt
            </button>
            <button
              type="button"
              onClick={onRepair}
              disabled={isBusy}
              className="flex items-center gap-1.5 rounded-md border border-amber-800 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-950/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Wrench size={14} aria-hidden="true" />
              Napraw
            </button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => void onRestoreFile(event)}
        />
      </header>

      <section className="grid grid-cols-5 gap-px border-b border-neutral-800 bg-neutral-800">
        <div className="bg-neutral-950 px-6 py-4">
          <span className="block text-[11px] uppercase text-neutral-500">Workspace</span>
          <span className="mt-1 block text-xl font-semibold text-neutral-100">
            {audit?.summary.workspaces ?? "-"}
          </span>
        </div>
        <div className="bg-neutral-950 px-6 py-4">
          <span className="block text-[11px] uppercase text-neutral-500">Zasoby</span>
          <span className="mt-1 block text-xl font-semibold text-neutral-100">
            {audit?.summary.resources ?? "-"}
          </span>
        </div>
        <div className="bg-neutral-950 px-6 py-4">
          <span className="block text-[11px] uppercase text-neutral-500">Wpisy czasu</span>
          <span className="mt-1 block text-xl font-semibold text-neutral-100">
            {audit?.summary.events ?? "-"}
          </span>
        </div>
        <div className="bg-neutral-950 px-6 py-4">
          <span className="block text-[11px] uppercase text-neutral-500">Outbox</span>
          <span className="mt-1 block text-xl font-semibold text-neutral-100">
            {audit?.summary.pendingOutbox ?? "-"}
          </span>
        </div>
        <div className="bg-neutral-950 px-6 py-4">
          <span className="block text-[11px] uppercase text-neutral-500">Problemy</span>
          <span
            className={`mt-1 block text-xl font-semibold ${
              errorCount > 0
                ? "text-red-300"
                : warningCount > 0
                  ? "text-amber-300"
                  : "text-emerald-300"
            }`}
          >
            {audit ? audit.issues.length : "-"}
          </span>
        </div>
      </section>

      <section className="flex-1 overflow-auto px-6 py-5">
        {busy && (
          <div className="mb-4 rounded-md border border-blue-900 bg-blue-950/30 px-3 py-2 text-xs text-blue-200">
            {busy === "export"
              ? "Eksport trwa..."
              : busy === "restore"
                ? "Przywracanie..."
                : busy === "repair"
                  ? "Naprawa..."
                  : "Audyt..."}
          </div>
        )}
        {error && (
          <div className="mb-4 flex gap-2 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-200">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        {message && (
          <div className="mb-4 flex gap-2 rounded-md border border-emerald-900 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
            <CheckCircle2 size={14} aria-hidden="true" />
            <span>{message}</span>
          </div>
        )}

        <div className="mb-4 flex items-center gap-2 text-sm text-neutral-200">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>
            {audit
              ? `Audyt: ${errorCount} błędów, ${warningCount} ostrzeżeń, ${issueCount(audit, "info")} informacji`
              : "Audyt nie został jeszcze wykonany"}
          </span>
          {audit?.generatedAt && (
            <span className="ml-auto text-xs text-neutral-500">
              {new Date(audit.generatedAt).toLocaleString()}
            </span>
          )}
        </div>

        {!audit || !hasIssues ? (
          <div className="flex h-48 items-center justify-center rounded-md border border-neutral-800 bg-neutral-900/40 text-sm text-neutral-500">
            Brak wykrytych problemów.
          </div>
        ) : (
          <ul className="space-y-2">
            {audit.issues.map((issue, index) => (
              <AuditIssueRow
                key={`${issue.code}:${issue.entity ?? "global"}:${issue.entity_id ?? index}`}
                issue={issue}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
