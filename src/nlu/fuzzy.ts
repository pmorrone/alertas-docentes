/** Levenshtein distance, giving up (returning max + 1) as soon as it exceeds `max`. */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length] as number;
}

/**
 * How many typos to tolerate for a word of this length. Short words must match exactly:
 * one edit turns "pila" into "pilar" (two different districts).
 */
export function maxTypos(length: number): number {
  if (length < 5) return 0;
  return length < 8 ? 1 : 2;
}

/**
 * The closest candidate within the typo tolerance, but only when it is unique at that
 * distance. Returns the candidates tied for best otherwise (possibly empty).
 */
export function closest(word: string, candidates: Iterable<string>): string[] {
  const limit = maxTypos(word.length);
  if (limit === 0) return [];
  let best = limit + 1;
  let found: string[] = [];
  for (const candidate of candidates) {
    const d = levenshtein(word, candidate, Math.min(limit, best));
    if (d > limit || d > best) continue;
    if (d < best) {
      best = d;
      found = [candidate];
    } else {
      found.push(candidate);
    }
  }
  return found;
}
