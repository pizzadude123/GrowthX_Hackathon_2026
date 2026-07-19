import { describe, expect, it } from 'vitest';
import { normalizeWaitlistEmail } from '../src/waitlist.js';

describe('waitlist email normalization', () => {
  it('normalizes a valid email for deterministic deduplication', () => {
    expect(normalizeWaitlistEmail('  Founder@Example.COM ')).toBe('founder@example.com');
  });

  it.each(['', 'not-an-email', 'name@example', 'name @example.com'])('rejects invalid email %j', (email) => {
    expect(() => normalizeWaitlistEmail(email)).toThrow('Enter a valid email address.');
  });

  it('rejects addresses beyond the email length limit', () => {
    expect(() => normalizeWaitlistEmail(`${'a'.repeat(245)}@example.com`)).toThrow('Enter a valid email address.');
  });
});
