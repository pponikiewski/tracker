import { supabase } from '@/lib/supabase';
import { getDb } from '@/lib/db/connection';
import type { CachedProfile } from '@/lib/db/types';

// ---- Validation ----

/**
 * Validates and trims a display name.
 *
 * Requirements 1.1, 1.2, 1.3:
 * - Trims leading/trailing whitespace before measuring length.
 * - Throws if the trimmed value is empty (length 0).
 * - Throws if the trimmed value exceeds 80 characters.
 * - Returns the trimmed value on success.
 */
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

// ---- Supabase writes ----

/**
 * Upserts the user's profile in the Supabase `profiles` table and writes the
 * result to the local `profiles_cache` table.
 *
 * Requirements 1.1, 1.2, 1.7:
 * - Validates the display name before any network request.
 * - Throws if Supabase is unavailable or the upsert fails.
 * - On success, updates the local cache so offline reads stay fresh.
 */
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

  // Mirror to local cache
  const db = await getDb();
  await db.execute(
    `INSERT INTO profiles_cache (user_id, display_name, avatar_url, cached_at)
     VALUES ($1, $2, (SELECT avatar_url FROM profiles_cache WHERE user_id = $1), $3)
     ON CONFLICT(user_id) DO UPDATE
       SET display_name = excluded.display_name,
           cached_at    = excluded.cached_at`,
    [userId, trimmed, Date.now()],
  );
}

// ---- Supabase reads + local cache writes ----

/**
 * Fetches profiles for the given user IDs from Supabase and writes them to the
 * local `profiles_cache` table.
 *
 * Requirements 1.5, 4.2:
 * - Reads from Supabase (RLS ensures only shared-workspace profiles are visible).
 * - Writes each fetched profile to the local cache for offline use.
 * - Returns the list of fetched (and cached) profiles.
 * - Throws if Supabase is unavailable or the query fails.
 */
export async function fetchAndCacheProfiles(userIds: string[]): Promise<CachedProfile[]> {
  if (userIds.length === 0) return [];

  // Filter to syntactically valid UUIDs. Supabase rejects anything else with
  // a 400 (e.g. the local-workspace sentinel 'local').
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validIds = userIds.filter((id) => UUID_RE.test(id));
  if (validIds.length === 0) return [];

  if (!supabase) {
    throw new Error('Supabase is not configured — cannot fetch profiles.');
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, display_name, avatar_url, updated_at')
    .in('user_id', validIds);

  if (error) {
    // Degrade gracefully when the `profiles` table does not exist yet in Supabase
    // (404 / PGRST205). Callers will fall back to email-prefix display names.
    if (error.code === 'PGRST205' || error.code === '42P01' || error.message?.includes('Could not find the table')) {
      console.warn('[profiles] table not found in Supabase — skipping remote fetch. Create the `profiles` table to enable shared display names and avatars.');
      return [];
    }
    throw new Error(`Failed to fetch profiles: ${error.message}`);
  }

  const rows = data ?? [];
  const cachedAt = Date.now();
  const db = await getDb();

  const result: CachedProfile[] = [];

  for (const row of rows) {
    await db.execute(
      `INSERT INTO profiles_cache (user_id, display_name, avatar_url, cached_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(user_id) DO UPDATE
         SET display_name = excluded.display_name,
             avatar_url   = excluded.avatar_url,
             cached_at    = excluded.cached_at`,
      [row.user_id, row.display_name, row.avatar_url ?? null, cachedAt],
    );

    result.push({
      user_id: row.user_id,
      display_name: row.display_name,
      avatar_url: row.avatar_url ?? null,
      cached_at: cachedAt,
    });
  }

  return result;
}

// ---- Local cache reads (offline-safe) ----

/**
 * Reads profiles from the local `profiles_cache` table only.
 *
 * Requirements 9.3:
 * - Never touches Supabase — safe to call when offline.
 * - Returns only the profiles that are present in the cache; missing user IDs
 *   are silently omitted (callers should fall back to email prefix / initials).
 */
export async function getCachedProfiles(userIds: string[]): Promise<CachedProfile[]> {
  if (userIds.length === 0) return [];

  const db = await getDb();
  const placeholders = userIds.map((_, i) => `$${i + 1}`).join(', ');
  return db.select<CachedProfile[]>(
    `SELECT user_id, display_name, avatar_url, cached_at
     FROM profiles_cache
     WHERE user_id IN (${placeholders})`,
    userIds,
  );
}

// ---- First-login bootstrap ----

/**
 * Ensures a profile record exists for the user.  Called once after a
 * successful login.
 *
 * Requirement 1.4:
 * - If no profile exists in Supabase, creates one with `display_name` set to
 *   the email address prefix (the portion before `@`).
 * - If a profile already exists, leaves it unchanged.
 * - Always writes the current profile to the local cache so it is available
 *   offline immediately after login.
 */
export async function ensureProfile(userId: string, email: string): Promise<void> {
  if (!supabase) {
    // Offline / unconfigured — write a minimal cache entry so the UI has
    // something to display.
    const emailPrefix = email.split('@')[0] ?? email;
    const db = await getDb();
    await db.execute(
      `INSERT INTO profiles_cache (user_id, display_name, avatar_url, cached_at)
       VALUES ($1, $2, NULL, $3)
       ON CONFLICT(user_id) DO NOTHING`,
      [userId, emailPrefix, Date.now()],
    );
    return;
  }

  // Check whether a profile already exists.
  const { data: existing, error: fetchError } = await supabase
    .from('profiles')
    .select('user_id, display_name, avatar_url')
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchError) {
    // Degrade gracefully when the `profiles` table does not exist yet in Supabase.
    if (fetchError.code === 'PGRST205' || fetchError.code === '42P01' || fetchError.message?.includes('Could not find the table')) {
      console.warn('[profiles] table not found in Supabase — ensureProfile is a no-op. Create the `profiles` table to enable shared display names and avatars.');
      // Seed the local cache with an email-prefix display name so the UI has something to show.
      const emailPrefix = email.split('@')[0] ?? email;
      const db = await getDb();
      await db.execute(
        `INSERT INTO profiles_cache (user_id, display_name, avatar_url, cached_at)
         VALUES ($1, $2, NULL, $3)
         ON CONFLICT(user_id) DO NOTHING`,
        [userId, emailPrefix, Date.now()],
      );
      return;
    }
    throw new Error(`Failed to check existing profile: ${fetchError.message}`);
  }

  const now = new Date().toISOString();

  if (!existing) {
    // First login — create profile with email prefix as default display name.
    const emailPrefix = email.split('@')[0] ?? email;

    const { error: insertError } = await supabase
      .from('profiles')
      .insert({ user_id: userId, display_name: emailPrefix, updated_at: now });

    if (insertError) {
      throw new Error(`Failed to create profile: ${insertError.message}`);
    }

    // Cache the newly created profile.
    const db = await getDb();
    await db.execute(
      `INSERT INTO profiles_cache (user_id, display_name, avatar_url, cached_at)
       VALUES ($1, $2, NULL, $3)
       ON CONFLICT(user_id) DO UPDATE
         SET display_name = excluded.display_name,
             cached_at    = excluded.cached_at`,
      [userId, emailPrefix, Date.now()],
    );
  } else {
    // Profile already exists — just refresh the local cache.
    const db = await getDb();
    await db.execute(
      `INSERT INTO profiles_cache (user_id, display_name, avatar_url, cached_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(user_id) DO UPDATE
         SET display_name = excluded.display_name,
             avatar_url   = excluded.avatar_url,
             cached_at    = excluded.cached_at`,
      [userId, existing.display_name, existing.avatar_url ?? null, Date.now()],
    );
  }
}
