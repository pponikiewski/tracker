// Feature: supabase-cloud-sync, Property 10: Email Validation
// Feature: supabase-cloud-sync, Property 11: Password Validation

/**
 * Validates email: must contain '@' AND length ≤ 254.
 * Returns null if valid, error message if invalid.
 */
export function validateEmail(email: string): string | null {
  if (!email.includes('@')) return 'Email must contain @';
  if (email.length > 254) return 'Email must be 254 characters or fewer';
  return null;
}

/**
 * Validates password: length ≥ 8 AND ≤ 128.
 * Returns null if valid, error message if invalid.
 */
export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (password.length > 128) return 'Password must be 128 characters or fewer';
  return null;
}
