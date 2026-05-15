// Feature: supabase-cloud-sync, Property 10: Email Validation
// Feature: supabase-cloud-sync, Property 11: Password Validation

/**
 * Validates email: must contain '@' AND length ≤ 254.
 * Returns null if valid, error message if invalid.
 */
export function validateEmail(email: string): string | null {
  if (!email.includes('@')) return 'Adres email musi zawierać @.';
  if (email.length > 254) return 'Adres email może mieć maksymalnie 254 znaki.';
  return null;
}

/**
 * Validates password: length ≥ 8 AND ≤ 128.
 * Returns null if valid, error message if invalid.
 */
export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Hasło musi mieć co najmniej 8 znaków.';
  if (password.length > 128) return 'Hasło może mieć maksymalnie 128 znaków.';
  return null;
}
