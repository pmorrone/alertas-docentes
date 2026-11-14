import type { Criteria } from '../matcher/index.js';

const overlaps = (alert: readonly string[], wanted: readonly string[]): boolean =>
  wanted.length === 0 || wanted.some((value) => alert.includes(value));

/**
 * Whether a saved alert is what the teacher refers to ("la de geografía"). Every field the
 * teacher mentioned must overlap with the alert; fields they did not mention are ignored.
 */
export function alertMatchesFilter(alert: Criteria, filter: Criteria): boolean {
  return (
    overlaps(alert.districts, filter.districts) &&
    overlaps(alert.levels, filter.levels) &&
    overlaps(alert.areas, filter.areas) &&
    overlaps(alert.shifts, filter.shifts) &&
    (!filter.onlySubstitutes || alert.onlySubstitutes)
  );
}

export function isEmptyFilter(filter: Criteria): boolean {
  return (
    filter.districts.length === 0 &&
    filter.levels.length === 0 &&
    filter.areas.length === 0 &&
    filter.shifts.length === 0 &&
    !filter.onlySubstitutes
  );
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');

/** Two alerts that would match exactly the same offers. */
export function sameCriteria(a: Criteria, b: Criteria): boolean {
  return (
    sameSet(a.districts, b.districts) &&
    sameSet(a.levels, b.levels) &&
    sameSet(a.areas, b.areas) &&
    sameSet(a.shifts, b.shifts) &&
    a.onlySubstitutes === b.onlySubstitutes
  );
}
