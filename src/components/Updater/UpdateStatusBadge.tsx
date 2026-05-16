import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, DownloadCloud, RefreshCcw, RotateCw, XCircle } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

type Status = "idle" | "checking" | "current" | "available" | "installing" | "error";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && (isTauri() || "__TAURI_INTERNALS__" in window);
}

function updateErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Nie udało się sprawdzić aktualizacji.";
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function UpdateStatusBadge() {
  const [enabled] = useState(() => isTauriRuntime());
  const [status, setStatus] = useState<Status>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState<number | null>(null);

  const checkForUpdate = useCallback(
    async (silent = false) => {
      if (!enabled || status === "checking" || status === "installing") return;
      if (!silent) {
        setStatus("checking");
        setMessage(null);
      }

      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const next = await check({ timeout: 15_000 });
        setUpdate(next);
        if (next) {
          setStatus("available");
          setMessage(`Dostępna wersja ${next.version}`);
        } else if (!silent) {
          setStatus("current");
          setMessage("Masz najnowszą wersję.");
        } else {
          setStatus("idle");
        }
      } catch (error) {
        if (silent) {
          console.warn("[updater] update check failed:", error);
          return;
        }
        setStatus("error");
        setMessage(updateErrorMessage(error));
      }
    },
    [enabled, status],
  );

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => void checkForUpdate(true), 2_000);
    return () => window.clearTimeout(timer);
  }, [checkForUpdate, enabled]);

  const installUpdate = async () => {
    if (!update || status === "installing") return;
    setStatus("installing");
    setMessage("Pobieranie aktualizacji...");
    setDownloaded(0);
    setTotal(null);

    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          setTotal(event.data.contentLength ?? null);
          setDownloaded(0);
        } else if (event.event === "Progress") {
          setDownloaded((value) => value + event.data.chunkLength);
        } else if (event.event === "Finished") {
          setMessage("Aktualizacja zainstalowana. Restart...");
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (error) {
      setStatus("error");
      setMessage(updateErrorMessage(error));
    }
  };

  if (!enabled) return null;

  const progress =
    status === "installing" && total
      ? `${formatBytes(downloaded)} / ${formatBytes(total)}`
      : message;

  if (status === "available" && update) {
    return (
      <button
        type="button"
        onClick={() => void installUpdate()}
        className="flex items-center gap-1.5 rounded-md border border-emerald-800 bg-emerald-950/40 px-2.5 py-1.5 text-left text-xs text-emerald-200 hover:bg-emerald-950"
        title={update.body ?? `Zainstaluj ${update.version}`}
      >
        <DownloadCloud size={13} aria-hidden="true" />
        <span className="min-w-0 truncate">{message}</span>
      </button>
    );
  }

  const Icon =
    status === "checking" || status === "installing"
      ? RotateCw
      : status === "error"
        ? XCircle
        : status === "current"
          ? CheckCircle2
          : RefreshCcw;
  const label =
    status === "checking"
      ? "Sprawdzanie..."
      : status === "installing"
        ? (progress ?? "Instalowanie...")
        : status === "error"
          ? "Błąd aktualizacji"
          : status === "current"
            ? "Aktualne"
            : "Aktualizacje";

  return (
    <button
      type="button"
      onClick={() => void checkForUpdate(false)}
      disabled={status === "checking" || status === "installing"}
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
        status === "error"
          ? "border-red-900 bg-red-950/30 text-red-200"
          : "border-neutral-800 text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
      }`}
      title={message ?? "Sprawdź aktualizacje"}
    >
      <Icon
        size={13}
        aria-hidden="true"
        className={status === "checking" || status === "installing" ? "animate-spin" : ""}
      />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
