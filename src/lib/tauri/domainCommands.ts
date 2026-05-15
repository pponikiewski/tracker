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

export interface CreateResourceTxInput {
  id: string;
  parentId: string | null;
  name: string;
  type: string;
  color?: string | null;
  workspaceId: string;
  timestamp: number;
  activityId: string;
  actorUserId?: string | null;
}

export interface RenameResourceTxInput {
  id: string;
  name: string;
  timestamp: number;
  activityId: string;
  actorUserId?: string | null;
}

export interface SetResourceColorTxInput {
  id: string;
  color: string | null;
  timestamp: number;
  activityId: string;
  actorUserId?: string | null;
}

export interface SoftDeleteSubtreeTxInput {
  id: string;
  timestamp: number;
  activityId: string;
  actorUserId?: string | null;
}

export interface LiftChildrenAndDeleteTxInput {
  id: string;
  timestamp: number;
  activityId: string;
  actorUserId?: string | null;
}

export interface DetachChildrenAsProjectsTxInput {
  id: string;
  timestamp: number;
  activityId: string;
  actorUserId?: string | null;
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

export interface UpdateEventTxInput {
  id: string;
  date: string;
  minutes: number;
  goal?: string | null;
  topics?: string | null;
  notes?: string | null;
  report?: string | null;
  timestamp: number;
  activityId: string;
  actorUserId?: string | null;
}

export interface DeleteEventTxInput {
  id: string;
  timestamp: number;
  activityId: string;
  actorUserId?: string | null;
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

export async function createResourceTx(input: CreateResourceTxInput): Promise<void> {
  await invoke("create_resource_tx", { input });
  await afterDomainMutation();
}

export async function renameResourceTx(input: RenameResourceTxInput): Promise<void> {
  await invoke("rename_resource_tx", { input });
  await afterDomainMutation();
}

export async function setResourceColorTx(input: SetResourceColorTxInput): Promise<void> {
  await invoke("set_resource_color_tx", { input });
  await afterDomainMutation();
}

export async function softDeleteSubtreeTx(input: SoftDeleteSubtreeTxInput): Promise<void> {
  await invoke("soft_delete_subtree_tx", { input });
  await afterDomainMutation();
}

export async function liftChildrenAndDeleteTx(input: LiftChildrenAndDeleteTxInput): Promise<void> {
  await invoke("lift_children_and_delete_tx", { input });
  await afterDomainMutation();
}

export async function detachChildrenAsProjectsTx(
  input: DetachChildrenAsProjectsTxInput,
): Promise<void> {
  await invoke("detach_children_as_projects_tx", { input });
  await afterDomainMutation();
}

export async function createEventTx(input: CreateEventTxInput): Promise<void> {
  await invoke("create_event_tx", { input });
  await afterDomainMutation();
}

export async function updateEventTx(input: UpdateEventTxInput): Promise<void> {
  await invoke("update_event_tx", { input });
  await afterDomainMutation();
}

export async function deleteEventTx(input: DeleteEventTxInput): Promise<void> {
  await invoke("delete_event_tx", { input });
  await afterDomainMutation();
}

export async function moveResourceTx(input: MoveResourceTxInput): Promise<void> {
  await invoke("move_resource_tx", { input });
  await afterDomainMutation();
}
