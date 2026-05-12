export type Entity = 'resource' | 'event';
export type Op = 'upsert' | 'delete';

export interface OutboxPayload {
  entity: Entity;
  entity_id: string;
  op: Op;
  data: Record<string, unknown>;
}
