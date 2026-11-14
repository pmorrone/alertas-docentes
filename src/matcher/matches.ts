import { normalizeText, type Offer } from '../collector/index.js';
import type { Criteria } from './criteria.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `term` appears in `haystack` as whole words (no match inside a longer word). */
function containsWords(haystack: string, term: string): boolean {
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(term)}(?![a-z0-9])`).test(haystack);
}

function matchesArea(offer: Offer, term: string): boolean {
  return normalizeText(offer.areaCode) === term || containsWords(offer.normalized.position, term);
}

/**
 * Pure matching of an offer against a teacher's criteria. No I/O, no clock.
 *
 * - Only "Publicada" offers can match.
 * - An offer without a known shift is not discarded by the shift filter (better a false
 *   alert than a missed one).
 */
export function matches(offer: Offer, criteria: Criteria): boolean {
  if (normalizeText(offer.status) !== 'publicada') return false;
  if (criteria.onlySubstitutes && !offer.isSubstitute) return false;

  if (criteria.districts.length > 0 && !criteria.districts.includes(offer.normalized.district)) {
    return false;
  }
  if (criteria.levels.length > 0 && !criteria.levels.includes(offer.normalized.level)) {
    return false;
  }
  if (criteria.areas.length > 0 && !criteria.areas.some((term) => matchesArea(offer, term))) {
    return false;
  }
  if (
    criteria.shifts.length > 0 &&
    offer.shifts.size > 0 &&
    !criteria.shifts.some((s) => offer.shifts.has(s))
  ) {
    return false;
  }
  return true;
}
