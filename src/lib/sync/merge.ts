// Feature: supabase-cloud-sync, Property 1: LWW Merge Correctness
// Feature: supabase-cloud-sync, Property 2: LWW Merge Idempotence

export interface MergeRow {
  id: string;
  updated_at: number | string;
}

export interface MergeResult<T> {
  writeSqlite: T[];   // Cloud wins — write to local
  pushOutbox: T[];    // Local wins — enqueue for push
}

const toMs = (v: number | string): number => {
  const n = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(n)) {
    throw new Error(`invalid LWW timestamp: ${JSON.stringify(v)}`);
  }
  return n;
};

/**
 * Last-Write-Wins merge.
 * - Cloud-only → writeSqlite
 * - Local-only → pushOutbox
 * - Both exist, cloud updated_at > local → writeSqlite
 * - Both exist, local updated_at > cloud → pushOutbox
 * - Both exist, equal updated_at → no-op (identical)
 */
export function lwwMerge<T extends MergeRow>(local: T[], cloud: T[]): MergeResult<T> {
  const localMap = new Map(local.map((r) => [r.id, r]));
  const cloudMap = new Map(cloud.map((r) => [r.id, r]));
  const allIds = new Set<string>([...localMap.keys(), ...cloudMap.keys()]);

  const writeSqlite: T[] = [];
  const pushOutbox: T[] = [];

  for (const id of allIds) {
    const l = localMap.get(id);
    const c = cloudMap.get(id);

    if (l && !c) {
      pushOutbox.push(l);
      continue;
    }
    if (!l && c) {
      writeSqlite.push(c);
      continue;
    }
    // Both exist — compare timestamps
    const lt = toMs(l!.updated_at);
    const ct = toMs(c!.updated_at);
    if (lt > ct) pushOutbox.push(l!);
    else if (ct > lt) writeSqlite.push(c!);
    // equal → no-op
  }

  return { writeSqlite, pushOutbox };
}
