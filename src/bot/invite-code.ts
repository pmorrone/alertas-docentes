import { randomInt } from 'node:crypto';

/** No I, O, 0 or 1: codes get read aloud and retyped. 8 characters give about 10^12 codes. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A random, hard-to-guess code. It fits in a Telegram deep link (`?start=<code>`). */
export function generateInviteCode(length = 8): string {
  return Array.from({ length }, () => ALPHABET.charAt(randomInt(ALPHABET.length))).join('');
}

/** Cleans what a person typed or a deep link carried. Undefined if it cannot be a code. */
export function normalizeInviteCode(raw: string): string | undefined {
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9]{4,32}$/.test(code) ? code : undefined;
}
