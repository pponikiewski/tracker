import { supabase } from '@/lib/supabase';

export interface JoinCode {
  code: string;
  workspace_id: string;
  created_by: string;
  created_at: string; // ISO
  expires_at: string; // ISO
  used_at: string | null;
  used_by: string | null;
}

/** Code validity window in milliseconds (5 minutes). */
export const JOIN_CODE_TTL_MS = 5 * 60 * 1000;

/** Generates a random 6-digit zero-padded code string. */
export function generateCodeString(): string {
  // crypto.getRandomValues for uniform distribution
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  const n = arr[0]! % 1_000_000;
  return n.toString().padStart(6, '0');
}

/** Returns true if the code string is exactly 6 decimal digits. */
export function isValidCodeFormat(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/**
 * Generates a fresh join code for the given workspace.
 *
 * Retries up to 5 times if the random code collides with an existing one.
 * Throws on unrecoverable failure (e.g. not authenticated, permission denied,
 * or persistent collisions).
 */
export async function generateJoinCode(workspaceId: string): Promise<JoinCode> {
  if (!supabase) throw new Error('Supabase nie jest skonfigurowany.');

  const { data: session } = await supabase.auth.getUser();
  const userId = session.user?.id;
  if (!userId) throw new Error('Musisz być zalogowany.');

  const expiresAt = new Date(Date.now() + JOIN_CODE_TTL_MS).toISOString();

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCodeString();
    const { data, error } = await supabase
      .from('workspace_join_codes')
      .insert({
        code,
        workspace_id: workspaceId,
        created_by: userId,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (!error && data) return data as JoinCode;

    lastError = error;
    // 23505 = unique violation — retry with a new random code
    if (error && error.code !== '23505') break;
  }

  const msg =
    lastError instanceof Error
      ? lastError.message
      : (lastError as { message?: string } | null)?.message ??
        'Nie udało się wygenerować kodu.';
  throw new Error(msg);
}

/**
 * Lists active (non-used, non-expired) codes for a workspace.
 * Only the workspace owner has SELECT access via RLS.
 */
export async function listActiveJoinCodes(workspaceId: string): Promise<JoinCode[]> {
  if (!supabase) return [];

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('workspace_join_codes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as JoinCode[];
}

/** Revokes (deletes) a join code. Only the owner has DELETE access via RLS. */
export async function revokeJoinCode(code: string): Promise<void> {
  if (!supabase) throw new Error('Supabase nie jest skonfigurowany.');
  const { error } = await supabase.from('workspace_join_codes').delete().eq('code', code);
  if (error) throw new Error(error.message);
}

/**
 * Redeems a join code by calling the Supabase RPC function.
 *
 * The RPC validates the code, inserts a membership for the current user,
 * and marks the code as used — all server-side under SECURITY DEFINER.
 *
 * Returns the workspace_id the user just joined.
 */
export async function redeemJoinCode(code: string): Promise<string> {
  if (!supabase) throw new Error('Supabase nie jest skonfigurowany.');
  if (!isValidCodeFormat(code)) {
    throw new Error('Kod musi składać się z 6 cyfr.');
  }

  const { data, error } = await supabase.rpc('redeem_workspace_join_code', {
    p_code: code,
  });

  if (error) {
    // 22023 = our custom "invalid/expired" signal
    if (error.code === '22023' || error.message?.toLowerCase().includes('invalid')) {
      throw new Error('Kod jest nieprawidłowy lub wygasł.');
    }
    throw new Error(error.message);
  }

  if (typeof data !== 'string') {
    throw new Error('Niepoprawna odpowiedź serwera.');
  }

  return data;
}
