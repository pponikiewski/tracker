export const RESOURCE_TYPES = ["project", "stage", "substage", "task"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export interface Resource {
  id: string;
  parent_id: string | null;
  name: string;
  type: ResourceType;
  color: string | null;
  path: string;
  cached_minutes: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface TimeEvent {
  id: string;
  resource_id: string;
  date: string;
  minutes: number;
  goal: string | null;
  topics: string | null;
  notes: string | null;
  report: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface ResourceNode extends Resource {
  children: ResourceNode[];
  effective_color: string;
}

/**
 * Returns the allowed child type for a given parent type, or null if leaf.
 * Hierarchy: project → stage → substage → task → (leaf).
 */
export function defaultChildType(parent: ResourceType): ResourceType | null {
  switch (parent) {
    case "project":
      return "stage";
    case "stage":
      return "substage";
    case "substage":
      return "task";
    case "task":
      return null;
  }
}

/**
 * Validates that `child` is allowed under `parent`.
 * Permits the direct chain (project→stage, stage→substage, substage→task)
 * and the shortcut to task from project/stage.
 */
export function canParent(parent: ResourceType, child: ResourceType): boolean {
  if (child === "project") return false;
  if (parent === "task") return false;
  if (child === "task") return parent === "project" || parent === "stage" || parent === "substage";
  if (child === "substage") return parent === "stage";
  if (child === "stage") return parent === "project";
  return false;
}

export interface Workspace {
  id: string;
  name: string;
  owner_id: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface WorkspaceMembership {
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'member';
  joined_at: number;
}

export interface Invite {
  id: string;
  workspace_id: string;
  invited_email: string;
  invited_by: string;
  token: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

export type OutboxEntity = 'resource' | 'event' | 'workspace' | 'workspace_membership';
export type OutboxOp = 'upsert' | 'delete';

export interface OutboxRow {
  id: number;
  entity: OutboxEntity;
  entity_id: string;
  op: OutboxOp;
  payload: string;
  enqueued_at: number;
  attempts: number;
  last_error: string | null;
  next_retry_at: number | null;
}
