import { describe, expect, it } from 'vitest';
import { cleanText, normalizeText } from '../../src/collector/index.js';

describe('text helpers', () => {
  it('collapses whitespace', () => {
    expect(cleanText('  PASTEUR   Y TUCUMAN \n')).toBe('PASTEUR Y TUCUMAN');
  });

  it('removes accents and lowercases', () => {
    expect(normalizeText('Matemática – CAÑUELAS ')).toBe('matematica – canuelas');
  });
});
