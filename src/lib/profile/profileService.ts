import { supabase } from '@/lib/supabase';
import { getDb } from '@/lib/db/connection';
import type { CachedProfile } from '@/lib/db/types';

// ---- Validation ----

export function validateDisplayName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('Display name cannot be empty.');
  }
  if (trimmed.length > 80) {
    throw new Error('Display name must be at most 80 characters.');
  }
  return trimmed;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export function validateAvatarColor(raw: string | null): string | null {
  if (raw === null) return null;
  if (!HEX_COLOR_RE.test(raw)) {
    throw new Error('Color must be a #RRGGBB hex string.');
  }
  return raw.toLowerCase();
}

// ---- Supabase writes ----

export async function upsertProfile(userId: string, displayName: string): Promise<void> {
  const trimmed = validateDisplayName(displayName);

  if (!supabase) {
    throw new Error('Supabase is not configured — cannot save profile.');
  }

  const now = new Date().toISOString();

  const { error } = await supabase
    .from('profiles')
    .upsert(
      { user_id: userId, display_name: trimmed, updated_at: now },
      { onConflict: 'user_id' },
    );

  if (error) {
    throw new Error(`Failed to save profile: ${error.message}`);
  }

  const db = await getDb();
  await db.execute(
    `INSERT INTO profiles_cache (user_id, display_name, avatar_url, avatar_color, cached_at)
     VALUES (
       $1,
       $2,
       (SELECT avatar_url FROM profiles_cache WHERE user_id = $1),
       (SELECT avatar_color FROM profiles_cache WHERE user_id = $1),
       $3
     )
     ON CONFLICT(user_id) DO UPDATE
       SET display_name = excluded.display_name,
           cached_at    = excluded.cached_at`,
    [userId, trimmed, Date.now()],
  );
}

export async function clearAvatarUrl(userId: string): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase is not configured — cannot clear avatar.');
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: null, updated_at: now })
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to clear avatar: ${error.message}`);
  }

  const db = await getDb();
  await db.execute(
    `UPDATE profiles_cache SET avatar_url = NULL, cached_at = $2 WHERE user_id = $1`,
    [userId, Date.now()],
  );
}

export async function setAvatarColor(userId: string, color: string | null): Promise<void> {
  const validated = validateAvatarColor(color);

  if (!supabase) {
    throw new Error('Supabase is not configured — cannot save avatar color.');
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_color: validated, updated_at: now })
    .eq('user_id', userId);

  if (error) {
    if (error.code === 'PGRST204' || error.message?.includes("avatar_color")) {
      throw new Error(
        'avatar_color column missing in Supabase profiles table. Run migration 20260725000002.',
      );
    }
    throw new Error(`Failed to save avatar color: ${error.message}`);
  }

  const db = await getDb();
  await db.execute(
    `UPDATE profiles_cache SET avatar_color = $2, cached_at = $3 WHERE user_id = $1`,
    [userId, validated, Date.now()],
  );
}

// ---- Supabase reads + local cache writes ----

export async function fetchAndCacheProfiles(userIds: string[]): Promise<CachedProfile[]> {
  if (userIds.length === 0) return [];

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validIds = userIds.filter((id) => UUID_RE.test(id));
  if (validIds.length === 0) return [];

  if (!supabase) {
    throw new Error('Supabase is not configured — cannot fetch profiles.');
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, display_name, avatar_url, avatar_color, updated_at')
    .in('user_id', validIds);

  if (error) {
    if (
      error.code === 'PGRST205' ||
      error.code === '42P01' ||
      error.message?.includes('Could not find the table')
    ) {
      console.warn(
        '[profiles] table not found in Supabase — skipping remote fetch.',
      );
      return [];
    }
    // Fallback: if avatar_color column missing, retry without it.
    if (error.message?.includes('avatar_color')) {
      const retry = await supabase
        .from('profiles')
        .select('user_id, display_name, avatar_url, updated_at')
        .in('user_id', validIds);
      if (retry.error) {
        throw new Error(`Failed to fetch profiles: ${retry.error.message}`);
      }
      return persistFetchedProfiles(
        (retry.data ?? []).map((row) => ({ ...row, avatar_color: null })),
      );
    }
    throw new Error(`Failed to fetch profiles: ${error.message}`);
  }

  return persistFetchedProfiles(data ?? []);
}

async function persistFetchedProfiles(
  rows: Array<{
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    avatar_color?: string | null;
  }>,
): Promise<CachedProfile[]> {
  const cachedAt = Date.now();
  const db = await getDb();
  const result: CachedProfile[] = [];

  for (const row of rows) {
    await db.execute(
      `INSERT INTO profiles_cache (user_id, display_name, avatar_url, avatar_color, cached_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(user_id) DO UPDATE
         SET display_name = excluded.display_name,
             avatar_url   = excluded.avatar_url,
             avatar_color = excluded.avatar_color,
             cached_at    = excluded.cached_at`,
      [row.user_id, row.display_name, row.avatar_url ?? null, row.avatar_color ?? null, cachedAt],
    );

    result.push({
      user_id: row.user_id,
      display_name: row.display_name,
      avatar_url: row.avatar_url ?? null,
      avatar_color: row.avatar_color ?? null,
      cached_at: cachedAt,
    });
  }

  return result;
}

// ---- Local cache reads (offline-safe) ----

export async function getCachedProfiles(userIds: string[]): Promise<CachedProfile[]> {
  if (userIds.length === 0) return [];

  const db = await getDb();
  const placeholders = userIds.map((_, i) => `$${i + 1}`).join(', ');
  return db.select<CachedProfile[]>(
    `SELECT user_id, display_name, avatar_url, avatar_color, cached_at
     FROM profiles_cache
     WHERE user_id IN (${placeholders})`,
    userIds,
  );
}

// ---- First-login bootstrap ----

export async function ensureProfile(userId: string, email: string): Promise<void> {
  if (!supabase) {
    const emailPrefix = email.split('@')[0] ?? email;
    const db = await getDb();
    await db.execute(
      `INSERT INTO profiles_cache (user_id, display_name, avatar_url, avatar_color, cached_at)
       VALUES ($1, $2, NULL, NULL, $3)
       ON CONFLICT(user_id) DO NOTHING`,
      [userId, emailPrefix, Date.now()],
    );
    return;
  }

  const { data: existing, error: fetchError } = await supabase
    .from('profiles')
    .select('user_id, display_name, avatar_url, avatar_color')
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchError) {
    if (
      fetchError.code === 'PGRST205' ||
      fetchError.code === '42P01' ||
      fetchError.message?.includes('Could not find the table')
    ) {
      console.warn('[profiles] table not found in Supabase — ensureProfile is a no-op.');
      const emailPrefix = email.split('@')[0] ?? email;
      const db = await getDb();
      await db.execute(
        `INSERT INTO profiles_cache (user_id, display_name, avatar_url, avatar_color, cached_at)
         VALUES ($1, $2, NULL, NULL, $3)
         ON CONFLICT(user_id) DO NOTHING`,
        [userId, emailPrefix, Date.now()],
      );
      return;
    }
    // If avatar_color column missing, retry without it.
    if (fetchError.message?.includes('avatar_color')) {
      const retry = await supabase
        .from('profiles')
        .select('user_id, display_name, avatar_url')
        .eq('user_id', userId)
        .maybeSingle();
      if (retry.error) {
        throw new Error(`Failed to check existing profile: ${retry.error.message}`);
      }
      await persistEnsuredProfile(userId, email, retry.data ?? null, null);
      return;
    }
    throw new Error(`Failed to check existing profile: ${fetchError.message}`);
  }

  await persistEnsuredProfile(
    userId,
    email,
    existing
      ? {
          user_id: existing.user_id,
          display_name: existing.display_name,
          avatar_url: existing.avatar_url ?? null,
        }
      : null,
    existing?.avatar_color ?? null,
  );
}

async function persistEnsuredProfile(
  userId: string,
  email: string,
  existing: { user_id: string; display_name: string; avatar_url: string | null } | null,
  avatarColor: string | null,
): Promise<void> {
  if (!supabase) return;
  const now = new Date().toISOString();

  if (!existing) {
    const emailPrefix = email.split('@')[0] ?? email;
    const { error: insertError } = await supabase
      .from('profiles')
      .insert({ user_id: userId, display_name: emailPrefix, updated_at: now });
    if (insertError) {
      throw new Error(`Failed to create profile: ${insertError.message}`);
    }
    const db = await getDb();
    await db.execute(
      `INSERT INTO profiles_cache (user_id, display_name, avatar_url, avatar_color, cached_at)
       VALUES ($1, $2, NULL, NULL, $3)
       ON CONFLICT(user_id) DO UPDATE
         SET display_name = excluded.display_name,
             cached_at    = excluded.cached_at`,
      [userId, emailPrefix, Date.now()],
    );
  } else {
    const db = await getDb();
    await db.execute(
      `INSERT INTO profiles_cache (user_id, display_name, avatar_url, avatar_color, cached_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(user_id) DO UPDATE
         SET display_name = excluded.display_name,
             avatar_url   = excluded.avatar_url,
             avatar_color = excluded.avatar_color,
             cached_at    = excluded.cached_at`,
      [userId, existing.display_name, existing.avatar_url ?? null, avatarColor, Date.now()],
    );
  }
}
