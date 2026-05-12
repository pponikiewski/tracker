// Feature: multi-tenant-schema, Property 4: Walidacja nazwy workspace
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateWorkspaceName } from '../workspace';

/**
 * Property 4: Walidacja nazwy workspace
 * Validates: Requirements 3.1, 3.2
 *
 * Reguły:
 * - Akceptowane: nazwy o długości 1–80 znaków (po trim)
 * - Odrzucane: puste stringi, stringi złożone wyłącznie z białych znaków, stringi >80 znaków po trim
 */

describe('Property 4: Walidacja nazwy workspace', () => {
  // Arbitraries

  /** Generuje string, którego trim ma długość 1–80 znaków */
  const validNameArb = fc
    .string({ minLength: 1, maxLength: 80 })
    .filter((s) => s.trim().length >= 1 && s.trim().length <= 80);

  /** Generuje string, którego trim jest pusty (pusty lub tylko whitespace) */
  const emptyOrWhitespaceArb = fc.oneof(
    fc.constant(''),
    fc.stringMatching(/^[ \t\n\r]+$/),
  );

  /** Generuje string, którego trim ma długość >80 znaków */
  const tooLongNameArb = fc
    .string({ minLength: 81, maxLength: 200 })
    .filter((s) => s.trim().length > 80);

  it('akceptuje nazwy o długości 1–80 znaków po trim', () => {
    fc.assert(
      fc.property(validNameArb, (name) => {
        expect(() => validateWorkspaceName(name)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('odrzuca puste stringi i stringi złożone wyłącznie z białych znaków', () => {
    fc.assert(
      fc.property(emptyOrWhitespaceArb, (name) => {
        expect(() => validateWorkspaceName(name)).toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('odrzuca nazwy dłuższe niż 80 znaków po trim', () => {
    fc.assert(
      fc.property(tooLongNameArb, (name) => {
        expect(() => validateWorkspaceName(name)).toThrow();
      }),
      { numRuns: 100 },
    );
  });

  // Przykłady graniczne
  it('akceptuje dokładnie 1 znak', () => {
    expect(() => validateWorkspaceName('a')).not.toThrow();
  });

  it('akceptuje dokładnie 80 znaków', () => {
    expect(() => validateWorkspaceName('a'.repeat(80))).not.toThrow();
  });

  it('odrzuca dokładnie 81 znaków', () => {
    expect(() => validateWorkspaceName('a'.repeat(81))).toThrow();
  });

  it('odrzuca pusty string', () => {
    expect(() => validateWorkspaceName('')).toThrow();
  });

  it('odrzuca string złożony wyłącznie ze spacji', () => {
    expect(() => validateWorkspaceName('   ')).toThrow();
  });

  it('akceptuje nazwę z wiodącymi/końcowymi spacjami, jeśli trim ma 1–80 znaków', () => {
    expect(() => validateWorkspaceName('  My workspace  ')).not.toThrow();
  });
});
