import { describe, expect, it } from 'vitest';
import { parseOffer, type Offer } from '../../src/collector/index.js';
import { PERSONAL_FIELDS, PERSONAL_SENTINELS, dump, makeDoc, sampleDoc } from './helpers.js';

function parseOk(doc: unknown): Offer {
  const result = parseOffer(doc);
  if (!result.ok) throw new Error(`expected ok, got ${result.issues.join('; ')}`);
  return result.offer;
}

describe('parseOffer', () => {
  it('normalizes the fixture doc', () => {
    const offer = parseOk(sampleDoc);

    expect(offer).toMatchObject({
      id: 4402588,
      offerId: 4418871,
      ige: 4391749,
      status: 'Publicada',
      districtName: 'PILAR',
      districtNumber: 83,
      levelName: 'ARTISTICA',
      position: 'Maestro de Danza Primaria (MDP)',
      areaCode: 'MDP',
      isSubstitute: true,
      workday: 'JS',
      modules: 2,
      school: '0083PP0032',
      address: 'PASTEUR Y TUCUMAN',
      notes: '',
    });
    expect(offer.normalized).toEqual({
      district: 'pilar',
      level: 'artistica',
      position: 'maestro de danza primaria (mdp)',
    });
  });

  it('converts dates to Date instances', () => {
    const offer = parseOk(sampleDoc);

    expect(offer.publishedAt).toEqual(new Date('2026-11-12T12:48:31.173Z'));
    expect(offer.closesAt).toEqual(new Date('2026-11-13T07:30:00Z'));
    expect(offer.substituteFrom).toEqual(new Date('2026-10-26T00:00:00Z'));
    expect(offer.substituteTo).toEqual(new Date('2026-11-24T00:00:00Z'));
    expect(offer.takesOfficeAt).toEqual(new Date('2026-10-27T00:00:00Z'));
  });

  it('keeps only the weekdays that have a schedule, as raw text', () => {
    expect(parseOk(sampleDoc).schedule).toEqual({ friday: '15 A 17' });
    expect(parseOk(makeDoc({ lunes: '8.40 a 9.40', martes: ' 7,30 A 9,40 HS ' })).schedule).toEqual(
      {
        monday: '8.40 a 9.40',
        tuesday: '7,30 A 9,40 HS',
        friday: '15 A 17',
      },
    );
  });

  it.each([
    ['T', ['T']],
    ['MT', ['M', 'T']],
    ['tm', ['M', 'T']],
    ['MTN', ['M', 'T', 'N']],
    ['MM', ['M']],
    ['', []],
    ['X', []],
  ])('parses shift %j as a set of letters', (turno, expected) => {
    expect([...parseOk(makeDoc({ turno })).shifts]).toEqual(expected);
  });

  it('flags non-substitute offers', () => {
    expect(parseOk(makeDoc({ supl_revista: 'T' })).isSubstitute).toBe(false);
    expect(parseOk(makeDoc({ supl_revista: '' })).isSubstitute).toBe(false);
  });

  it('accepts ids as numeric strings and tolerates missing optional fields', () => {
    const offer = parseOk({
      iddetalle: '42',
      estado: 'Publicada',
      descdistrito: 'TANDIL',
      iniciooferta: '2026-11-12T12:00:00Z',
      finoferta: '2026-11-13T12:00:00Z',
    });

    expect(offer.id).toBe(42);
    expect(offer.shifts.size).toBe(0);
    expect(offer.substituteFrom).toBeNull();
    expect(offer.schedule).toEqual({});
  });

  it('normalizes accents for comparison but keeps the display text', () => {
    const offer = parseOk(
      makeDoc({ descdistrito: 'CAÑUELAS', cargo: 'Matemática – Ciclo Superior (MCS)' }),
    );

    expect(offer.districtName).toBe('CAÑUELAS');
    expect(offer.normalized.district).toBe('canuelas');
    expect(offer.normalized.position).toContain('matematica');
  });

  it('rejects docs missing required fields without echoing raw values', () => {
    const result = parseOffer({ ...sampleDoc, iddetalle: undefined, finoferta: 'not a date' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join(' ')).toContain('iddetalle');
    expect(result.issues.join(' ')).toContain('finoferta');
    expect(result.issues.join(' ')).not.toContain('not a date');
  });

  it('rejects non-object docs', () => {
    expect(parseOffer(null).ok).toBe(false);
    expect(parseOffer('x').ok).toBe(false);
  });

  describe('personal data', () => {
    it('leaves no personal data from the fixture in the result', () => {
      const output = dump(parseOk(sampleDoc));

      for (const value of ['20000000001', '20000000002', 'APELLIDO NOMBRE', 'Licencia']) {
        expect(output).not.toContain(value);
      }
    });

    it('drops every personal field, whatever its value', () => {
      const offer = parseOk(makeDoc({ ...PERSONAL_SENTINELS }));
      const output = dump(offer);

      for (const field of PERSONAL_FIELDS) {
        expect(output).not.toContain(PERSONAL_SENTINELS[field]);
        expect(output.toLowerCase()).not.toContain(field);
        expect(offer).not.toHaveProperty(field);
      }
      expect(output).not.toMatch(/\d{11}/);
    });

    it('does not leak personal data through validation issues', () => {
      const result = parseOffer(makeDoc({ ...PERSONAL_SENTINELS, iddetalle: 'bad' }));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const output = dump(result);
      for (const field of PERSONAL_FIELDS) {
        expect(output).not.toContain(PERSONAL_SENTINELS[field]);
      }
    });
  });
});
