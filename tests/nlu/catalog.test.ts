import { describe, expect, it } from 'vitest';
import { validateSynonyms } from '../../src/nlu/index.js';
import { catalog, synonyms } from './helpers.js';

describe('catalogs', () => {
  it('load the real fixtures', () => {
    expect(catalog.districts).toHaveLength(135);
    expect(catalog.levels).toHaveLength(11);
    expect(catalog.areas.length).toBeGreaterThan(1000);
  });

  it('normalize area names so they can be compared', () => {
    const htr = catalog.areas.find((a) => a.code === 'HTR');
    expect(htr).toMatchObject({ key: 'historia', tokens: ['historia'] });
    const fq = catalog.areas.find((a) => a.code === 'FQA');
    expect(fq?.key).toBe('fisico quimica');
  });
});

describe('data/sinonimos.json', () => {
  it('only points to districts, levels and area codes that exist in the catalogs', () => {
    expect(validateSynonyms(catalog, synonyms)).toEqual([]);
  });

  it('is detected when a synonym points nowhere', () => {
    const broken = {
      distritos: { x: 'narnia' },
      niveles: { y: 'universidad' },
      areas: { z: ['NOPE'] },
    };
    expect(validateSynonyms(catalog, broken)).toHaveLength(3);
  });
});
