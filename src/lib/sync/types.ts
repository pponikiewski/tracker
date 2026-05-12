export type Entity = 'resource' | 'event' | 'workspace' | 'workspace_membership';
export type Op = 'upsert' | 'delete';

export interface OutboxPayload {
  entity: Entity;
  entity_id: string;
  op: Op;
  data: Record<string, unknown>;
}
