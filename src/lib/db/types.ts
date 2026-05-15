export const RESOURCE_TYPES = ["project", "stage", "substage", "task"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export interface Resource {
  id: string;
  workspace_id: string;
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
  workspace_id: string;
  resource_id: string;
  date: string;
  minutes: number;
  goal: string | null;
  topics: string | null;
  notes: string | null;
  report: string | null;
  user_id: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface ResourceNode extends Resource {
  children: ResourceNode[];
  effective_color: string;
}

/**
 * Allowed children for each parent type.
 * Hierarchy: project → stage → substage → task.
 * - task is a universal leaf-or-branch (allowed under everything, incl. itself)
 * - project nests only inside project (the only way a project becomes a subproject)
 */
const ALLOWED_CHILDREN: Record<ResourceType, ResourceType[]> = {
  project: ["project", "stage", "task"],
  stage: ["substage", "task"],
  substage: ["task"],
  task: ["task"],
};

/**
 * Returns the default child type for the "+" / add-child action.
 * project → stage, stage → substage, substage → task, task → task.
 */
export function defaultChildType(parent: ResourceType): ResourceType {
  switch (parent) {
    case "project":
      return "stage";
    case "stage":
      return "substage";
    case "substage":
      return "task";
    case "task":
      return "task";
  }
}

/** True if `child` is allowed directly under `parent`. */
export function canParent(parent: ResourceType, child: ResourceType): boolean {
  return ALLOWED_CHILDREN[parent].includes(child);
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
  display_role?: string | null;
  display_role_updated_at?: number | null;
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

export interface Assignment {
  id: string;
  resource_id: string;
  user_id: string;
  workspace_id: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface CachedProfile {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  cached_at: number;
}

export type Entity =
  | 'resource'
  | 'event'
  | 'workspace'
  | 'workspace_membership'
  | 'assignment';

export type OutboxEntity = Entity;
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
