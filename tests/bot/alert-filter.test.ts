import { describe, expect, it } from 'vitest';
import { alertMatchesFilter, isEmptyFilter, sameCriteria } from '../../src/bot/alert-filter.js';
import { createCriteria } from '../../src/matcher/index.js';

const geo = createCriteria({ areas: ['ggf', 'g.f'], districts: ['tandil'], shifts: ['M'] });

describe('alertMatchesFilter', () => {
  it('matches when every mentioned field overlaps', () => {
    expect(alertMatchesFilter(geo, createCriteria({ areas: ['ggf'] }))).toBe(true);
    expect(alertMatchesFilter(geo, createCriteria({ areas: ['ggf'], districts: ['tandil'] }))).toBe(
      true,
    );
  });

  it('ignores fields the teacher did not mention', () => {
    expect(alertMatchesFilter(geo, createCriteria({}))).toBe(true);
  });

  it('rejects when a mentioned field does not overlap', () => {
    expect(alertMatchesFilter(geo, createCriteria({ areas: ['htr'] }))).toBe(false);
    expect(alertMatchesFilter(geo, createCriteria({ districts: ['pilar'] }))).toBe(false);
    expect(alertMatchesFilter(geo, createCriteria({ shifts: ['T'] }))).toBe(false);
  });

  it('only matches substitute-only alerts when the filter asks for them', () => {
    const subs = createCriteria({ areas: ['ggf'], onlySubstitutes: true });
    expect(alertMatchesFilter(geo, createCriteria({ onlySubstitutes: true }))).toBe(false);
    expect(alertMatchesFilter(subs, createCriteria({ onlySubstitutes: true }))).toBe(true);
  });
});

describe('isEmptyFilter / sameCriteria', () => {
  it('detects an empty filter', () => {
    expect(isEmptyFilter(createCriteria({}))).toBe(true);
    expect(isEmptyFilter(createCriteria({ districts: ['tandil'] }))).toBe(false);
    expect(isEmptyFilter(createCriteria({ onlySubstitutes: true }))).toBe(false);
  });

  it('compares criteria ignoring order', () => {
    const a = createCriteria({
      districts: ['tandil', 'pilar'],
      areas: ['htr'],
      shifts: ['T', 'M'],
    });
    const b = createCriteria({
      districts: ['pilar', 'tandil'],
      areas: ['htr'],
      shifts: ['M', 'T'],
    });
    expect(sameCriteria(a, b)).toBe(true);
    expect(sameCriteria(a, { ...b, onlySubstitutes: true })).toBe(false);
    expect(sameCriteria(a, createCriteria({ districts: ['tandil'], areas: ['htr'] }))).toBe(false);
  });
});
