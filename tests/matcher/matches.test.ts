import { describe, expect, it } from 'vitest';
import { createCriteria, matches } from '../../src/matcher/index.js';
import { makeOffer } from './helpers.js';

// Fixture offer: PILAR, ARTISTICA, MDP "Maestro de Danza Primaria (MDP)", turno T, suplencia.
const offer = makeOffer();

describe('matches', () => {
  it('matches everything published when there are no filters', () => {
    expect(matches(offer, createCriteria({}))).toBe(true);
  });

  it.each(['Designada', 'Anulada', 'Renunciada', 'Desierta'])(
    'never matches %s offers',
    (estado) => {
      expect(matches(makeOffer({ estado }), createCriteria({}))).toBe(false);
    },
  );

  describe('districts', () => {
    it('matches ignoring case and accents', () => {
      const canuelas = makeOffer({ descdistrito: 'CAÑUELAS' });
      expect(matches(canuelas, createCriteria({ districts: ['cañuelas'] }))).toBe(true);
      expect(matches(canuelas, createCriteria({ districts: ['Canuelas'] }))).toBe(true);
    });

    it('matches any of several districts', () => {
      const criteria = createCriteria({ districts: ['Tandil', 'Pilar'] });
      expect(matches(offer, criteria)).toBe(true);
    });

    it('rejects other districts', () => {
      expect(matches(offer, createCriteria({ districts: ['tandil'] }))).toBe(false);
    });

    it('requires the whole name, not a prefix', () => {
      const offerGp = makeOffer({ descdistrito: 'GENERAL PUEYRREDON' });
      expect(matches(offerGp, createCriteria({ districts: ['general'] }))).toBe(false);
      expect(matches(offerGp, createCriteria({ districts: ['General Pueyrredon'] }))).toBe(true);
    });
  });

  describe('levels', () => {
    it('matches by level name', () => {
      expect(matches(offer, createCriteria({ levels: ['artistica'] }))).toBe(true);
      expect(matches(offer, createCriteria({ levels: ['secundaria'] }))).toBe(false);
    });

    it('matches any of several levels', () => {
      expect(matches(offer, createCriteria({ levels: ['Secundaria', 'Artística'] }))).toBe(true);
    });
  });

  describe('areas', () => {
    it('matches an areaincumbencia code exactly, ignoring case', () => {
      expect(matches(offer, createCriteria({ areas: ['mdp'] }))).toBe(true);
      expect(matches(offer, createCriteria({ areas: ['MCS'] }))).toBe(false);
    });

    it('matches free text against the position, ignoring accents', () => {
      const math = makeOffer({
        areaincumbencia: 'MCS',
        cargo: 'MATEMÁTICA - CICLO SUPERIOR (MCS)',
        descripcionarea: 'MATEMÁTICA - CICLO SUPERIOR (MCS)',
        descripcioncargo: 'MATEMÁTICA - CICLO SUPERIOR (MCS)',
      });
      expect(matches(math, createCriteria({ areas: ['matematica'] }))).toBe(true);
      expect(matches(math, createCriteria({ areas: ['ciclo superior'] }))).toBe(true);
      expect(matches(math, createCriteria({ areas: ['historia'] }))).toBe(false);
    });

    it('matches whole words only', () => {
      const hist = makeOffer({
        areaincumbencia: 'HTR',
        cargo: 'PREHISTORIA (HTR)',
        descripcionarea: 'PREHISTORIA (HTR)',
        descripcioncargo: 'PREHISTORIA (HTR)',
      });
      expect(matches(hist, createCriteria({ areas: ['historia'] }))).toBe(false);
      expect(matches(hist, createCriteria({ areas: ['prehistoria'] }))).toBe(true);
    });

    it('treats regex characters in free text literally', () => {
      expect(matches(offer, createCriteria({ areas: ['(mdp)'] }))).toBe(true);
      expect(matches(offer, createCriteria({ areas: ['.*'] }))).toBe(false);
    });

    it('matches any of several areas', () => {
      expect(matches(offer, createCriteria({ areas: ['mcs', 'danza'] }))).toBe(true);
    });
  });

  describe('shifts', () => {
    it('matches when the shift is selected', () => {
      expect(matches(offer, createCriteria({ shifts: ['T'] }))).toBe(true);
      expect(matches(offer, createCriteria({ shifts: ['M', 'T'] }))).toBe(true);
    });

    it('rejects when the shift is not selected', () => {
      expect(matches(offer, createCriteria({ shifts: ['M', 'N'] }))).toBe(false);
    });

    it('treats combined shifts as a set of letters', () => {
      const mt = makeOffer({ turno: 'MT' });
      expect(matches(mt, createCriteria({ shifts: ['M'] }))).toBe(true);
      expect(matches(mt, createCriteria({ shifts: ['T'] }))).toBe(true);
      expect(matches(mt, createCriteria({ shifts: ['N'] }))).toBe(false);
    });

    it('does not discard offers whose shift is unknown', () => {
      expect(matches(makeOffer({ turno: '' }), createCriteria({ shifts: ['M'] }))).toBe(true);
    });
  });

  describe('onlySubstitutes', () => {
    it('keeps substitute offers', () => {
      expect(matches(offer, createCriteria({ onlySubstitutes: true }))).toBe(true);
    });

    it('rejects non-substitute offers', () => {
      const titular = makeOffer({ supl_revista: 'T' });
      expect(matches(titular, createCriteria({ onlySubstitutes: true }))).toBe(false);
      expect(matches(titular, createCriteria({ onlySubstitutes: false }))).toBe(true);
    });
  });

  it('ANDs the different filters', () => {
    const all = createCriteria({
      districts: ['pilar'],
      levels: ['artistica'],
      areas: ['mdp'],
      shifts: ['T'],
      onlySubstitutes: true,
    });
    expect(matches(offer, all)).toBe(true);
    expect(matches(offer, { ...all, districts: ['tandil'] })).toBe(false);
    expect(matches(offer, { ...all, shifts: ['M'] })).toBe(false);
  });
});

describe('createCriteria', () => {
  it('applies defaults', () => {
    expect(createCriteria({})).toEqual({
      districts: [],
      levels: [],
      areas: [],
      shifts: [],
      onlySubstitutes: false,
    });
  });

  it('normalizes text and drops blanks and duplicates', () => {
    const c = createCriteria({
      districts: ['  Cañuelas ', 'CANUELAS', ''],
      areas: ['Matemática'],
      shifts: ['T', 'M', 'T'],
    });
    expect(c.districts).toEqual(['canuelas']);
    expect(c.areas).toEqual(['matematica']);
    expect(c.shifts).toEqual(['M', 'T']);
  });

  it('rejects invalid input (e.g. a bad shift from the LLM)', () => {
    // @ts-expect-error deliberately invalid shift
    expect(() => createCriteria({ shifts: ['X'] })).toThrow();
  });
});
