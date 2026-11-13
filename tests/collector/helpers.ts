import { readFileSync } from 'node:fs';

export type RawDoc = Record<string, unknown>;

interface Fixture {
  response: { numFound: number; start: number; docs: RawDoc[] };
}

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/oferta-publicada.json', import.meta.url), 'utf8'),
) as Fixture;

/** The sample doc from the fixture. It keeps the fake personal data the API returns. */
export const sampleDoc: RawDoc = fixture.response.docs[0] as RawDoc;

export const PERSONAL_FIELDS = [
  'cuilautor',
  'reemp_apeynom',
  'reemp_cuil',
  'reemp_motivo',
  'nombreganador',
  'cuilganador',
  'postulacion_idganador',
] as const;

/** Distinctive values to prove they never leak into normalized output. */
export const PERSONAL_SENTINELS: Record<(typeof PERSONAL_FIELDS)[number], string> = {
  cuilautor: '20111111111',
  reemp_apeynom: 'PEREZ JUANA SENTINEL',
  reemp_cuil: '27222222222',
  reemp_motivo: 'MOTIVO-SENTINEL',
  nombreganador: 'GANADOR SENTINEL',
  cuilganador: '20333333333',
  postulacion_idganador: '9999999',
};

export function makeDoc(overrides: RawDoc = {}): RawDoc {
  return { ...sampleDoc, ...overrides };
}

/** JSON.stringify that also serializes Sets, so Offers can be inspected as text. */
export function dump(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (v instanceof Set ? [...v] : v));
}

/** Encodes text as Windows-1252/Latin-1 bytes, like the real API does. */
export function latin1Response(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(Buffer.from(JSON.stringify(body), 'latin1'), init);
}

export function solrBody(docs: unknown[], numFound = docs.length, start = 0) {
  return { responseHeader: { status: 0 }, response: { numFound, start, docs } };
}
