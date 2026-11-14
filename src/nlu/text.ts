import { normalizeText } from '../collector/index.js';

/**
 * Lowercase, accent-free word tokens. Punctuation (including Spanish "¿¡") is dropped:
 * "¡Historía, en Pilar!" -> ["historia", "en", "pilar"].
 */
export function tokenize(text: string): string[] {
  return normalizeText(text)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t !== '');
}

/** Canonical key for comparing phrases: tokens joined by single spaces. */
export function keyOf(text: string): string {
  return tokenize(text).join(' ');
}

/** Whether `needle` appears as a contiguous run of tokens inside `haystack`. */
export function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((token, j) => haystack[i + j] === token)) return true;
  }
  return false;
}

/** "MAESTRO DE GRADO" -> "Maestro de grado". */
export function sentenceCase(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim().toLowerCase();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
