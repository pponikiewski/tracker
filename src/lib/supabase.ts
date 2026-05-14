import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !key) {
  console.warn(
    '[supabase] env vars missing — cloud sync disabled. ' +
      'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local ' +
      'and RESTART `pnpm dev` (Vite reads env vars only at startup).',
  );
} else {
  console.info('[supabase] client configured for', url);
}

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null;
