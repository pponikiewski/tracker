/**
 * Konwertuje materialized path (slash-separated UUIDs) na format ltree.
 * Zamienia każdy '-' na '_' i każdy '/' na '.'.
 *
 * @param path - Materialized path, np. "550e8400-e29b-41d4-a716-446655440000/6ba7b810-9dad-11d1-80b4-00c04fd430c8"
 * @returns Ścieżka w formacie ltree, np. "550e8400_e29b_41d4_a716_446655440000.6ba7b810_9dad_11d1_80b4_00c04fd430c8"
 * @throws Error jeśli input jest pusty lub zawiera znaki inne niż cyfry szesnastkowe, myślniki i ukośniki
 */
export function pathToLtree(path: string): string {
  if (path.length === 0) {
    throw new Error('pathToLtree: input must not be empty');
  }

  const invalidChars = path.match(/[^0-9a-fA-F\-/]/g);
  if (invalidChars) {
    const unique = [...new Set(invalidChars)];
    throw new Error(
      `pathToLtree: invalid characters found: ${unique.map((c) => JSON.stringify(c)).join(', ')}`,
    );
  }

  return path.replace(/-/g, '_').replace(/\//g, '.');
}

/**
 * Konwertuje ltree path z powrotem na materialized path (slash-separated UUIDs).
 * Zamienia każdy '_' na '-' i każdy '.' na '/'.
 *
 * @param ltree - Ścieżka ltree, np. "550e8400_e29b_41d4_a716_446655440000.6ba7b810_9dad_11d1_80b4_00c04fd430c8"
 * @returns Materialized path, np. "550e8400-e29b-41d4-a716-446655440000/6ba7b810-9dad-11d1-80b4-00c04fd430c8"
 * @throws Error jeśli input jest pusty lub zawiera znaki inne niż cyfry szesnastkowe, podkreślenia i kropki
 */
export function ltreeToPath(ltree: string): string {
  if (ltree.length === 0) {
    throw new Error('ltreeToPath: input must not be empty');
  }

  const invalidChars = ltree.match(/[^0-9a-fA-F_.]/g);
  if (invalidChars) {
    const unique = [...new Set(invalidChars)];
    throw new Error(
      `ltreeToPath: invalid characters found: ${unique.map((c) => JSON.stringify(c)).join(', ')}`,
    );
  }

  return ltree.replace(/_/g, '-').replace(/\./g, '/');
}
