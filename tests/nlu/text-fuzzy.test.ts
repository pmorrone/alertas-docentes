import { describe, expect, it } from 'vitest';
import { closest, levenshtein, maxTypos } from '../../src/nlu/fuzzy.js';
import { containsRun, keyOf, sentenceCase, tokenize } from '../../src/nlu/text.js';

describe('tokenize', () => {
  it('drops accents, case and punctuation', () => {
    expect(tokenize('¡Historía, en Pilar! (tarde)')).toEqual(['historia', 'en', 'pilar', 'tarde']);
  });

  it('turns ñ into n and keeps numbers', () => {
    expect(tokenize('Cañuelas, 9 de Julio')).toEqual(['canuelas', '9', 'de', 'julio']);
  });

  it('builds comparable keys', () => {
    expect(keyOf('FISICO - QUIMICA')).toBe('fisico quimica');
    expect(keyOf('  Jose C. Paz ')).toBe('jose c paz');
  });
});

describe('containsRun / sentenceCase', () => {
  it('requires a contiguous run of tokens', () => {
    const haystack = ['maestro', 'de', 'musica', 'primaria'];
    expect(containsRun(haystack, ['de', 'musica'])).toBe(true);
    expect(containsRun(haystack, ['maestro', 'musica'])).toBe(false);
    expect(containsRun(haystack, [])).toBe(false);
  });

  it('capitalizes only the first letter', () => {
    expect(sentenceCase('MAESTRO  DE GRADO')).toBe('Maestro de grado');
  });
});

describe('fuzzy matching', () => {
  it('measures edit distance', () => {
    expect(levenshtein('matematica', 'matematika')).toBe(1);
    expect(levenshtein('pilar', 'pila')).toBe(1);
    expect(levenshtein('abc', 'xyz', 1)).toBeGreaterThan(1);
  });

  it('tolerates more typos in longer words and none in short ones', () => {
    expect(maxTypos(4)).toBe(0);
    expect(maxTypos(6)).toBe(1);
    expect(maxTypos(10)).toBe(2);
  });

  it('never fuzzy-matches short words', () => {
    expect(closest('pila', ['pilar'])).toEqual([]);
  });

  it('returns the unique closest candidate, or all of them when tied', () => {
    expect(closest('tandill', ['tandil', 'azul', 'rauch'])).toEqual(['tandil']);
    expect(closest('rauchh', ['rauch', 'azul'])).toEqual(['rauch']);
    expect(closest('balcarca', ['balcarce', 'balcarda'])).toEqual(['balcarce', 'balcarda']);
    expect(closest('zzzzzzzz', ['tandil'])).toEqual([]);
  });
});
