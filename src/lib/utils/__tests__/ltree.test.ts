// Feature: multi-tenant-schema, Property 1: Round-trip konwersji ltree
// Feature: multi-tenant-schema, Property 2: Poprawnosc konwersji pathToLtree
// Feature: multi-tenant-schema, Property 3: Odrzucanie niepoprawnych danych
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { pathToLtree, ltreeToPath } from '../ltree';

// Arbitrary: pojedynczy segment UUID v4 (hex + myślniki)
const uuidSegmentArb = fc.uuid();

// Arbitrary: materialized path z 1–10 segmentów UUID oddzielonych '/'
const materializedPathArb = fc
  .array(uuidSegmentArb, { minLength: 1, maxLength: 10 })
  .map((segments) => segments.join('/'));

describe('Property 1: Round-trip konwersji ltree', () => {
  /**
   * Validates: Requirements 5.7, 12.3
   *
   * Dla dowolnego poprawnego materialized path, konwersja do ltree i z powrotem
   * powinna zwrócić oryginalną ścieżkę.
   */
  it('ltreeToPath(pathToLtree(path)) === path dla dowolnego poprawnego materialized path', () => {
    fc.assert(
      fc.property(materializedPathArb, (path) => {
        const ltree = pathToLtree(path);
        const roundTripped = ltreeToPath(ltree);
        expect(roundTripped).toBe(path);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 2: Poprawnosc konwersji pathToLtree', () => {
  /**
   * Validates: Requirements 5.3, 12.1
   *
   * Wynik pathToLtree nie powinien zawierać '-' ani '/'.
   * Każdy '-' powinien być zastąpiony '_', każdy '/' powinien być zastąpiony '.'.
   */
  it('wynik nie zawiera "-" ani "/"; "-" → "_", "/" → "."', () => {
    fc.assert(
      fc.property(materializedPathArb, (path) => {
        const ltree = pathToLtree(path);

        // Brak myślników i ukośników w wyniku
        expect(ltree).not.toMatch(/-/);
        expect(ltree).not.toMatch(/\//);

        // Każdy '-' w oryginale odpowiada '_' w wyniku
        const expectedFromDashes = path.replace(/-/g, '_').replace(/\//g, '.');
        expect(ltree).toBe(expectedFromDashes);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 3: Odrzucanie niepoprawnych danych', () => {
  /**
   * Validates: Requirements 12.4, 12.5
   *
   * pathToLtree rzuca Error dla pustego stringa lub znaków spoza [0-9a-fA-F\-/].
   * ltreeToPath rzuca Error dla pustego stringa lub znaków spoza [0-9a-fA-F_.].
   */

  // Arbitrary: pojedynczy znak (kod ASCII 32–126) będący niedozwolonym dla pathToLtree
  const invalidCharForPathArb = fc
    .integer({ min: 32, max: 126 })
    .map((code) => String.fromCharCode(code))
    .filter((c) => !/[0-9a-fA-F\-/]/.test(c));

  // Arbitrary: pojedynczy znak (kod ASCII 32–126) będący niedozwolonym dla ltreeToPath
  const invalidCharForLtreeArb = fc
    .integer({ min: 32, max: 126 })
    .map((code) => String.fromCharCode(code))
    .filter((c) => !/[0-9a-fA-F_.]/.test(c));

  // Arbitrary: niepusty string zawierający co najmniej jeden niedozwolony znak dla pathToLtree
  const invalidPathArb = fc
    .tuple(
      fc.string({ minLength: 0, maxLength: 10 }),
      invalidCharForPathArb,
      fc.string({ minLength: 0, maxLength: 10 }),
    )
    .map(([pre, bad, post]) => pre + bad + post);

  // Arbitrary: niepusty string zawierający co najmniej jeden niedozwolony znak dla ltreeToPath
  const invalidLtreeArb = fc
    .tuple(
      fc.string({ minLength: 0, maxLength: 10 }),
      invalidCharForLtreeArb,
      fc.string({ minLength: 0, maxLength: 10 }),
    )
    .map(([pre, bad, post]) => pre + bad + post);

  it('pathToLtree rzuca Error dla pustego stringa', () => {
    expect(() => pathToLtree('')).toThrow(Error);
  });

  it('ltreeToPath rzuca Error dla pustego stringa', () => {
    expect(() => ltreeToPath('')).toThrow(Error);
  });

  it('pathToLtree rzuca Error dla stringów z niedozwolonymi znakami', () => {
    fc.assert(
      fc.property(invalidPathArb, (invalid) => {
        expect(() => pathToLtree(invalid)).toThrow(Error);
      }),
      { numRuns: 100 },
    );
  });

  it('ltreeToPath rzuca Error dla stringów z niedozwolonymi znakami', () => {
    fc.assert(
      fc.property(invalidLtreeArb, (invalid) => {
        expect(() => ltreeToPath(invalid)).toThrow(Error);
      }),
      { numRuns: 100 },
    );
  });
});
