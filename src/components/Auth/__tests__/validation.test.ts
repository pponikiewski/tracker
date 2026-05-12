// Feature: supabase-cloud-sync, Property 10: Email Validation
// Feature: supabase-cloud-sync, Property 11: Password Validation
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateEmail, validatePassword } from '../validation';

// Property 10: Email Validation
// Validates: Requirements 2.4
describe('Property 10: Email Validation', () => {
  it('accepts strings that contain @ AND have length ≤ 254', () => {
    fc.assert(fc.property(
      // Generate valid emails: prefix + '@' + suffix, total ≤ 254
      fc.string({ minLength: 1, maxLength: 100 }).chain((prefix) =>
        fc.string({ minLength: 1, maxLength: 100 }).map((suffix) => `${prefix}@${suffix}`)
      ).filter((s) => s.length <= 254),
      (email) => {
        expect(validateEmail(email)).toBeNull();
      }
    ), { numRuns: 100 });
  });

  it('rejects strings without @', () => {
    fc.assert(fc.property(
      fc.string({ minLength: 0, maxLength: 254 }).filter((s) => !s.includes('@')),
      (email) => {
        expect(validateEmail(email)).not.toBeNull();
      }
    ), { numRuns: 100 });
  });

  it('rejects strings longer than 254 characters', () => {
    fc.assert(fc.property(
      fc.string({ minLength: 255, maxLength: 500 }).map((s) => s + '@x'),
      (email) => {
        expect(validateEmail(email)).not.toBeNull();
      }
    ), { numRuns: 100 });
  });
});

// Property 11: Password Validation
// Validates: Requirements 2.5
describe('Property 11: Password Validation', () => {
  it('accepts strings with length ≥ 8 AND ≤ 128', () => {
    fc.assert(fc.property(
      fc.string({ minLength: 8, maxLength: 128 }),
      (password) => {
        expect(validatePassword(password)).toBeNull();
      }
    ), { numRuns: 100 });
  });

  it('rejects strings shorter than 8 characters', () => {
    fc.assert(fc.property(
      fc.string({ minLength: 0, maxLength: 7 }),
      (password) => {
        expect(validatePassword(password)).not.toBeNull();
      }
    ), { numRuns: 100 });
  });

  it('rejects strings longer than 128 characters', () => {
    fc.assert(fc.property(
      fc.string({ minLength: 129, maxLength: 300 }),
      (password) => {
        expect(validatePassword(password)).not.toBeNull();
      }
    ), { numRuns: 100 });
  });
});

// Example-based tests
describe('validateEmail examples', () => {
  it('valid emails', () => {
    expect(validateEmail('user@example.com')).toBeNull();
    expect(validateEmail('a@b')).toBeNull();
  });

  it('invalid: no @', () => {
    expect(validateEmail('userexample.com')).not.toBeNull();
    expect(validateEmail('')).not.toBeNull();
  });

  it('invalid: too long', () => {
    expect(validateEmail('a'.repeat(253) + '@b')).not.toBeNull();
  });
});

describe('validatePassword examples', () => {
  it('valid passwords', () => {
    expect(validatePassword('12345678')).toBeNull();
    expect(validatePassword('a'.repeat(128))).toBeNull();
  });

  it('invalid: too short', () => {
    expect(validatePassword('1234567')).not.toBeNull();
    expect(validatePassword('')).not.toBeNull();
  });

  it('invalid: too long', () => {
    expect(validatePassword('a'.repeat(129))).not.toBeNull();
  });
});
