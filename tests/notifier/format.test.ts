import { describe, expect, it } from 'vitest';
import {
  APD_URL,
  formatApiDateTime,
  formatOffer,
  formatSearchResults,
  titleCase,
} from '../../src/notifier/format.js';
import { makeOffer } from '../matcher/helpers.js';

// The fixture offer: Maestro de Danza Primaria, ARTISTICA, PILAR, turno T, suplencia
// 26/10 -> 24/11, 2°B (after decoding), viernes "15 A 17", closes 13/11 07:30, 2 hs.

describe('formatOffer', () => {
  it('formats the fixture offer like the spec example', () => {
    const { text, url } = formatOffer(makeOffer({ cursodivision: '2°B' }), [
      'Danza · Pilar · Tarde',
    ]);

    expect(text).toBe(
      [
        '🆕 <b>Maestro de Danza Primaria (MDP)</b>, Artistica, Pilar',
        '2°B · Turno T · Suplencia del 26/10 al 24/11 · Hs/módulos: 2',
        'Vie 15 A 17',
        '📍 Pasteur y Tucuman (0083PP0032)',
        '⏰ Cierra: 13/11 07:30',
        '🔔 Tu alerta: Danza · Pilar · Tarde',
      ].join('\n'),
    );
    expect(url).toBe(APD_URL);
  });

  it('shows the dates and times as the API sends them (no timezone shift)', () => {
    // 00:00Z must stay on the same day, and 07:30 must stay 07:30.
    const offer = makeOffer({
      supl_desde: '2026-11-16T00:00:00Z',
      supl_hasta: '2026-11-24T00:00:00Z',
      finoferta: '2026-11-13T07:30:00Z',
    });
    const { text } = formatOffer(offer, []);

    expect(text).toContain('Suplencia del 16/11 al 24/11');
    expect(text).toContain('⏰ Cierra: 13/11 07:30');
    expect(formatApiDateTime(new Date('2026-01-05T10:05:00Z'))).toBe('05/01 10:05');
  });

  it('lists the schedule per weekday in order', () => {
    const offer = makeOffer({ lunes: '8.40 a 9.40', martes: '7.30 a 9.40', viernes: '' });
    expect(formatOffer(offer, []).text).toContain('Lun 8.40 a 9.40 · Mar 7.30 a 9.40');
  });

  it('names every matching alert', () => {
    const { text } = formatOffer(makeOffer(), ['Danza · Pilar', 'Primaria · Pilar']);
    expect(text).toContain('🔔 Tus alertas: Danza · Pilar · Primaria · Pilar');
  });

  it('handles shifts, titulares and missing pieces', () => {
    const { text } = formatOffer(
      makeOffer({
        turno: 'MT',
        supl_revista: 'T',
        cursodivision: '',
        hsmodulos: undefined,
        domiciliodesempeno: '',
        escuela: '',
        viernes: '',
      }),
      [],
    );
    expect(text).toContain('Turno M/T');
    expect(text).not.toContain('Suplencia');
    expect(text).not.toContain('📍');
    expect(text).not.toContain('Hs/módulos');
    expect(text).not.toContain('🔔');
  });

  it('says "Suplencia" when the dates are unknown', () => {
    const offer = makeOffer({ supl_desde: undefined, supl_hasta: undefined });
    expect(formatOffer(offer, []).text).toContain('· Suplencia');
  });

  it('escapes HTML coming from the API and truncates long notes', () => {
    const { text } = formatOffer(
      makeOffer({
        cargo: 'Matemática <script> & más',
        observaciones: `<b>x</b> ${'a'.repeat(300)}`,
      }),
      ['<alerta>'],
    );

    expect(text).toContain('Matemática &lt;script&gt; &amp; más');
    expect(text).toContain('📝 &lt;b&gt;x&lt;/b&gt;');
    expect(text).toContain('…');
    expect(text).toContain('&lt;alerta&gt;');
    expect(text).not.toContain('<script>');
  });
});

describe('titleCase', () => {
  it('capitalizes every word', () => {
    expect(titleCase('GENERAL  PUEYRREDON')).toBe('General Pueyrredon');
    expect(titleCase('9 DE JULIO')).toBe('9 de Julio');
    expect(titleCase('LOMAS DE ZAMORA')).toBe('Lomas de Zamora');
    expect(titleCase('DE LA PLATA')).toBe('De la Plata');
  });
});

describe('formatSearchResults', () => {
  it('lists the offers in one message under a header', () => {
    const offers = [
      makeOffer({ iddetalle: 1 }),
      makeOffer({ iddetalle: 2, cargo: 'Historia (HTR)' }),
    ];

    const { text, shown } = formatSearchResults(offers, 2, 'Danza · Pilar');

    expect(shown).toBe(2);
    expect(text.startsWith('🔎 <b>2 ofertas publicadas</b> ahora para <b>Danza · Pilar</b>:')).toBe(
      true,
    );
    expect(text).toContain('▫️ <b>Maestro de Danza Primaria (MDP)</b>');
    expect(text).toContain('▫️ <b>Historia (HTR)</b>');
    expect(text).not.toContain('🆕');
    expect(text).not.toContain('🔔'); // there is no alert to mention
  });

  it('uses the singular and handles no results', () => {
    expect(formatSearchResults([makeOffer()], 1, 'X').text).toContain('<b>1 oferta publicada</b>');
    expect(formatSearchResults([], 0, 'Historia · Pilar').text).toBe(
      '🔎 Ahora no hay ofertas publicadas para <b>Historia · Pilar</b>.',
    );
  });

  it('says how many more there are', () => {
    const { text } = formatSearchResults([makeOffer()], 9, 'X');
    expect(text).toContain('… y 8 más. Las ves todas en el sitio de APD.');
  });

  it('stays under the Telegram limit by showing fewer offers', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      makeOffer({ iddetalle: i + 1, observaciones: 'x'.repeat(190) }),
    );

    const { text, shown } = formatSearchResults(many, 20, 'X');

    expect(text.length).toBeLessThan(4096);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(20);
    expect(text).toContain(`… y ${20 - shown} más`);
  });

  it('escapes the label', () => {
    expect(formatSearchResults([], 0, '<b>').text).toContain('&lt;b&gt;');
  });
});
