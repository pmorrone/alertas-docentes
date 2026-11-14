import { describe, expect, it } from 'vitest';
import { generateInviteCode, normalizeInviteCode } from '../../src/bot/invite-code.js';

describe('invite codes', () => {
  it('generates codes that are safe to read aloud and fit in a deep link', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateInviteCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    }
  });

  it('does not repeat in practice', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateInviteCode()));
    expect(codes.size).toBe(1000);
  });

  it('normalizes what a person typed', () => {
    expect(normalizeInviteCode(' abcd2345 ')).toBe('ABCD2345');
  });

  it('rejects text that cannot be a code', () => {
    expect(normalizeInviteCode('')).toBeUndefined();
    expect(normalizeInviteCode('abc')).toBeUndefined();
    expect(normalizeInviteCode('hola que tal')).toBeUndefined();
    expect(normalizeInviteCode("ABCD2345'; DROP")).toBeUndefined();
  });
});
