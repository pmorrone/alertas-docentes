/** Trims and collapses internal whitespace. */
export function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Lowercases and strips diacritics so free text can be compared safely
 * ("Matemática" -> "matematica", "Cañuelas" -> "canuelas").
 */
export function normalizeText(value: string): string {
  return cleanText(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
