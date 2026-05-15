import { invoke } from "@tauri-apps/api/core";
import { getDb } from "@/lib/db/connection";
import { countPendingForUser } from "@/lib/sync/outbox";
import { useAuthStore } from "@/store/auth";

export interface CreateWorkspaceTxInput {
  id: string;
  name: string;
  ownerId: string;
  timestamp: number;
  activityId: string;
}

export interface CreateEventTxInput {
  id: string;
  resourceId: string;
  date: string;
  minutes: number;
  goal?: string | null;
  topics?: string | null;
  notes?: string | null;
  report?: string | null;
  workspaceId: string;
  userId?: string | null;
  timestamp: number;
  activityId: string;
}

export interface MoveResourceTxInput {
  id: string;
  newParentId: string | null;
  timestamp: number;
  activityId: string;
  userId?: string | null;
}

async function afterDomainMutation(): Promise<void> {
  const auth = useAuthStore.getState();
  const userId = auth.state.kind === "authed" ? auth.state.user.id : null;
  const db = await getDb();
  auth.setPendingCount(await countPendingForUser(db, userId));
  void import("@/lib/sync/worker")
    .then(({ tick }) => tick({ silent: true }))
    .catch((err) => console.warn("[cloud] immediate save failed:", err));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("tracker:activity-log-changed"));
  }
}

export async function createWorkspaceTx(input: CreateWorkspaceTxInput): Promise<void> {
  await invoke("create_workspace_tx", { input });
  await afterDomainMutation();
}

export async function createEventTx(input: CreateEventTxInput): Promise<void> {
  await invoke("create_event_tx", { input });
  await afterDomainMutation();
}

export async function moveResourceTx(input: MoveResourceTxInput): Promise<void> {
  await invoke("move_resource_tx", { input });
  await afterDomainMutation();
}
