import { describe, expect, it } from 'vitest';
import { expectCreate, expectQuestion, interpreter, sorted } from './helpers.js';

const interpret = (text: string) => interpreter.interpret(text);

describe('create: complete requests', () => {
  it('"historia en pilar a la tarde"', () => {
    const result = expectCreate(interpret('historia en pilar a la tarde'));

    expect(result.criteria).toEqual({
      districts: ['pilar'],
      levels: [],
      areas: ['htr', 'h.i'],
      shifts: ['T'],
      onlySubstitutes: false,
    });
    expect(result.summary).toBe('Historia · Pilar · Tarde');
  });

  it('"primaria en general pueyrredon"', () => {
    const result = expectCreate(interpret('primaria en general pueyrredon'));

    expect(result.criteria).toMatchObject({
      districts: ['general pueyrredon'],
      levels: ['primaria'],
      areas: [],
      shifts: [],
    });
    expect(result.summary).toBe('Primaria · General Pueyrredon');
  });

  it('"suplencias de inglés turno mañana en tandil"', () => {
    const result = expectCreate(interpret('suplencias de inglés turno mañana en tandil'));

    expect(result.criteria).toEqual({
      districts: ['tandil'],
      levels: [],
      areas: ['igs', '/ai'],
      shifts: ['M'],
      onlySubstitutes: true,
    });
    expect(result.summary).toBe('Inglés · Tandil · Mañana · Solo suplencias');
  });

  it('understands a spoken-style sentence with several districts', () => {
    const result = expectCreate(
      interpret('Quiero que me avises de matemática en Ayacucho y Rauch por la tarde'),
    );

    expect(sorted(result.criteria.districts)).toEqual(['ayacucho', 'rauch']);
    expect(result.criteria.areas).toEqual(['mtm', 'mcs']);
    expect(result.criteria.shifts).toEqual(['T']);
    expect(result.summary).toBe('Matemática · Ayacucho, Rauch · Tarde');
  });

  it('ignores case, accents and punctuation', () => {
    const result = expectCreate(interpret('¡HISTORÍA, en Pilar! (tarde)'));
    expect(result.criteria).toMatchObject({ districts: ['pilar'], shifts: ['T'] });
  });

  it('accepts several shifts', () => {
    const result = expectCreate(interpret('geografía de mañana y tarde en tandil'));
    expect(result.criteria.shifts).toEqual(['M', 'T']);
    expect(result.summary).toBe('Geografía · Tandil · Mañana y Tarde');
  });

  it('splits "historia y geografía" into two areas', () => {
    const result = expectCreate(interpret('historia y geografia en tandil'));
    expect(result.criteria.areas).toEqual(['htr', 'h.i', 'ggf', 'g.f']);
    expect(result.summary).toBe('Historia, Geografia · Tandil');
  });

  it('keeps area names that contain "y" whole', () => {
    const result = expectCreate(interpret('lengua y literatura en tandil'));
    expect(result.criteria.areas).toEqual(['plg', 'lit']);
  });
});

describe('create: names, aliases and synonyms', () => {
  it('"mardel" is General Pueyrredon', () => {
    const result = expectCreate(interpret('mardel secundaria biologia'));
    expect(result.criteria.districts).toEqual(['general pueyrredon']);
    expect(result.criteria.levels).toEqual(['secundaria']);
    expect(result.criteria.areas).toContain('blg');
  });

  it('accepts the short form of "General X" districts', () => {
    expect(expectCreate(interpret('primaria en pueyrredon')).criteria.districts).toEqual([
      'general pueyrredon',
    ]);
    expect(expectCreate(interpret('inicial en san martin')).criteria.districts).toEqual([
      'general san martin',
    ]);
  });

  it('understands districts with numbers and multiple words', () => {
    const result = expectCreate(interpret('primaria en 9 de julio'));
    expect(result.criteria.districts).toEqual(['9 de julio']);
    expect(
      expectCreate(interpret('maestra de grado en lomas de zamora')).criteria.districts,
    ).toEqual(['lomas de zamora']);
  });

  it('does not confuse Pilar with Pila', () => {
    expect(expectCreate(interpret('secundaria en pilar')).criteria.districts).toEqual(['pilar']);
    expect(expectCreate(interpret('secundaria en pila')).criteria.districts).toEqual(['pila']);
  });

  it('maps colloquial levels and positions', () => {
    expect(expectCreate(interpret('jardin en tandil')).criteria.levels).toEqual(['inicial']);
    const grade = expectCreate(interpret('maestra de grado en tandil'));
    expect(grade.criteria.areas).toEqual(['/mg', 'mg5']);
    expect(grade.summary).toBe('Maestra de grado · Tandil');
  });

  it('treats "educación física" as a level', () => {
    const result = expectCreate(interpret('profesor de educación física en azul'));
    expect(result.criteria).toMatchObject({ levels: ['educacion fisica'], areas: [] });
  });

  it('keeps "ciclo superior" as part of the area, not the Superior level', () => {
    const result = expectCreate(interpret('matematica ciclo superior en tandil'));
    expect(result.criteria).toMatchObject({ areas: ['mcs'], levels: [] });
  });
});

describe('create: typos and transcription errors', () => {
  it('fixes misspelled areas and districts', () => {
    const result = expectCreate(interpret('matematika en tandill a la mañana'));
    expect(result.criteria).toMatchObject({ districts: ['tandil'], areas: ['mtm', 'mcs'] });
  });

  it('fixes a misspelled multi-word district', () => {
    const result = expectCreate(interpret('general pueyredon primaria'));
    expect(result.criteria.districts).toEqual(['general pueyrredon']);
  });

  it('fixes a misspelled level', () => {
    const result = expectCreate(interpret('secundria en pilar'));
    expect(result.criteria.levels).toEqual(['secundaria']);
  });

  it('ignores filler words it does not understand and says so', () => {
    const result = expectCreate(interpret('avisame bla bla de historia en pilar'));
    expect(result.criteria.areas).toEqual(['htr', 'h.i']);
    expect(result.notes).toEqual(['No entendí «bla bla» y lo ignoré.']);
  });

  it('warns about filters it cannot apply yet', () => {
    const result = expectCreate(interpret('titular de historia en pilar'));
    expect(result.criteria.districts).toEqual(['pilar']);
    expect(result.notes[0]).toContain('titular');
  });
});

describe('questions', () => {
  it('asks for the district when it is missing', () => {
    const question = expectQuestion(interpret('historia a la mañana'));

    expect(question).toMatchObject({ field: 'district', reason: 'missing', options: [] });
    expect(question.state.draft.areas).toEqual(['htr', 'h.i']);
    expect(question.state.draft.shifts).toEqual(['M']);
  });

  it('asks what to look for when only a district was given', () => {
    const question = expectQuestion(interpret('tandil'));
    expect(question).toMatchObject({ field: 'topic', reason: 'missing' });
    expect(question.state.draft.districts).toEqual(['tandil']);
  });

  it('asks for everything on a bare "quiero crear una alerta"', () => {
    expect(expectQuestion(interpret('quiero crear una alerta'))).toMatchObject({
      field: 'district',
      reason: 'missing',
    });
  });

  it('completes the request with the free-text answer', () => {
    const question = expectQuestion(interpret('historia a la mañana'));

    const result = expectCreate(interpreter.interpret('en pilar', question.state));

    expect(result.criteria).toMatchObject({
      districts: ['pilar'],
      areas: ['htr', 'h.i'],
      shifts: ['M'],
    });
    expect(result.summary).toBe('Historia · Pilar · Mañana');
  });

  it('asks again when the answer does not help', () => {
    const question = expectQuestion(interpret('historia a la mañana'));
    const again = expectQuestion(interpreter.interpret('no sé', question.state));
    expect(again.field).toBe('district');
  });

  it('offers options when an area is ambiguous, and applies the chosen one', () => {
    const question = expectQuestion(interpret('ciencias en tandil'));

    expect(question).toMatchObject({ field: 'area', reason: 'ambiguous' });
    const labels = question.options.map((o) => o.label);
    expect(labels).toContain('Ciencias naturales');
    expect(labels).toContain('Ciencias sociales');
    expect(labels.at(-1)).toBe('Cualquiera que diga «ciencias»');

    const chosen = labels.indexOf('Ciencias naturales');
    const result = expectCreate(interpreter.answer(question, chosen));
    expect(result.criteria).toMatchObject({ districts: ['tandil'], areas: ['cnt'] });
    expect(result.summary).toBe('Ciencias naturales · Tandil');
  });

  it('"cualquiera que diga" keeps a free-text area', () => {
    const question = expectQuestion(interpret('ciencias en tandil'));
    const result = expectCreate(interpreter.answer(question, question.options.length - 1));
    expect(result.criteria.areas).toEqual(['ciencias']);
  });

  it('asks tarde or noche for "vespertino"', () => {
    const question = expectQuestion(interpret('historia vespertino en pilar'));
    expect(question).toMatchObject({ field: 'shift', reason: 'ambiguous' });
    expect(question.options.map((o) => o.label)).toEqual(['Tarde', 'Noche', 'Tarde y noche']);

    const result = expectCreate(interpreter.answer(question, 1));
    expect(result.criteria.shifts).toEqual(['N']);
  });

  it('asks the pending questions one at a time', () => {
    const first = expectQuestion(interpret('ciencias vespertino'));
    const second = expectQuestion(interpreter.answer(first, 0));
    expect(sorted([first.field, second.field])).toEqual(['area', 'shift']);

    const third = expectQuestion(interpreter.answer(second, 0));
    expect(third.field).toBe('district');
    expect(third.state.draft.shifts.length + third.state.draft.areas.length).toBeGreaterThan(0);
  });

  it('asks to rephrase an unknown subject instead of guessing', () => {
    const question = expectQuestion(interpret('quiero zzzzzz en pilar'));
    expect(question).toMatchObject({ field: 'area', reason: 'unrecognized', options: [] });
    expect(question.state.draft.districts).toEqual(['pilar']);
  });

  it('ignores an invalid option index by asking again', () => {
    const question = expectQuestion(interpret('ciencias en tandil'));
    expect(expectQuestion(interpreter.answer(question, 99)).field).toBe('area');
  });
});

describe('other intents', () => {
  it.each([
    'mostrame mis alertas',
    'qué alertas tengo',
    'ver mis alertas',
    'cuáles son mis alertas',
  ])('view: "%s"', (text) => {
    expect(interpret(text)).toEqual({ kind: 'view' });
  });

  it.each(['ayuda', 'Ayudame por favor', '/start', 'cómo funciona esto?', 'no entiendo'])(
    'help: "%s"',
    (text) => {
      expect(interpret(text)).toEqual({ kind: 'help' });
    },
  );

  it.each(['hola qué tal', 'asdfgh', '', '   ', '¿?', 'gracias'])('unknown: "%s"', (text) => {
    expect(interpret(text)).toEqual({ kind: 'unknown' });
  });

  it('delete: "borrá la de geografía" describes which alert', () => {
    const result = interpret('borrá la de geografía');

    expect(result).toMatchObject({
      kind: 'delete',
      all: false,
      filter: { areas: ['ggf', 'g.f'], districts: [] },
      summary: 'Geografía',
    });
  });

  it('delete: can name district and shift too', () => {
    const result = interpret('eliminá la alerta de historia en tandil a la mañana');
    expect(result).toMatchObject({
      kind: 'delete',
      filter: { districts: ['tandil'], areas: ['htr', 'h.i'], shifts: ['M'] },
    });
  });

  it('delete: all alerts', () => {
    expect(interpret('borrar todas mis alertas')).toMatchObject({
      kind: 'delete',
      all: true,
      summary: 'Todas tus alertas',
    });
  });

  it('delete without details leaves the filter empty so the bot can ask which one', () => {
    const result = interpret('quiero borrar una alerta');
    expect(result).toMatchObject({ kind: 'delete', all: false });
    if (result.kind === 'delete') {
      expect(result.filter).toEqual({
        districts: [],
        levels: [],
        areas: [],
        shifts: [],
        onlySubstitutes: false,
      });
    }
  });

  it('delete never asks clarifying questions about the subject', () => {
    const result = interpret('borrá la de ciencias');
    expect(result.kind).toBe('delete');
  });
});

describe('search intent ("what is there right now")', () => {
  it.each([
    'qué hay hoy en tandil',
    'hay algo de historia en tandil',
    'mostrame ofertas de historia en tandil',
    'ver las ofertas en tandil',
    'qué ofertas hay en tandil',
  ])('"%s" is a search', (text) => {
    expect(interpret(text).kind).toBe('search');
  });

  it('carries the same criteria and summary as an alert would', () => {
    const result = interpret('qué hay hoy de historia en pilar a la tarde');
    expect(result).toMatchObject({
      kind: 'search',
      summary: 'Historia · Pilar · Tarde',
      criteria: { districts: ['pilar'], areas: ['htr', 'h.i'], shifts: ['T'] },
    });
  });

  it('does not require a district: a search can be broad', () => {
    expect(interpret('qué hay de historia')).toMatchObject({
      kind: 'search',
      criteria: { districts: [], areas: ['htr', 'h.i'] },
    });
  });

  it('asks what to look for when nothing was said, then completes with the answer', () => {
    const question = expectQuestion(interpret('qué hay hoy'));
    expect(question).toMatchObject({ field: 'topic', reason: 'missing' });

    const result = interpreter.interpret('inglés en rauch', question.state);
    expect(result).toMatchObject({ kind: 'search', criteria: { districts: ['rauch'] } });
  });

  it('asks the usual questions when the subject is ambiguous', () => {
    const question = expectQuestion(interpret('qué hay de ciencias en tandil'));
    expect(question.field).toBe('area');
    const index = question.options.findIndex((o) => o.label === 'Ciencias naturales');
    expect(interpreter.answer(question, index)).toMatchObject({
      kind: 'search',
      criteria: { areas: ['cnt'] },
    });
  });

  it('does not steal other intents', () => {
    expect(interpret('avisame si hay ofertas de historia en pilar').kind).toBe('create');
    expect(interpret('buscame cargos de historia en tandil').kind).toBe('create');
    expect(interpret('mostrame mis alertas').kind).toBe('view');
    expect(interpret('qué alertas tengo').kind).toBe('view');
    expect(interpret('borrá la alerta de historia').kind).toBe('delete');
  });
});

describe('output is always valid matcher criteria', () => {
  it('produces normalized, deduplicated criteria', () => {
    const result = expectCreate(interpret('historia historia en Pilar pilar tarde tarde'));
    expect(result.criteria.districts).toEqual(['pilar']);
    expect(result.criteria.shifts).toEqual(['T']);
    expect(new Set(result.criteria.areas).size).toBe(result.criteria.areas.length);
  });
});
