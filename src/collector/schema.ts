import { z } from 'zod';
import { cleanText, normalizeText } from './text.js';
import { SHIFTS, WEEKDAYS, type Offer, type Shift, type Weekday } from './offer.js';

/*
 * Zod objects strip unknown keys, so declaring only the fields we need means personal data
 * (cuilautor, reemp_*, nombreganador, cuilganador, postulacion_idganador) is discarded at
 * parse time and can never reach an `Offer`, the database or the logs.
 */

const text = z
  .string()
  .nullish()
  .transform((s) => cleanText(s ?? ''));

const numeric = z.union([z.number(), z.string()]);

const optionalNumber = numeric.nullish().transform((v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
});

const requiredId = numeric.transform((v, ctx) => {
  const n = Number(v);
  if (v === '' || !Number.isInteger(n) || n <= 0) {
    ctx.addIssue({ code: 'custom', message: 'expected a positive integer id' });
    return z.NEVER;
  }
  return n;
});

const requiredDate = z.string().transform((s, ctx) => {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: 'custom', message: 'invalid date' });
    return z.NEVER;
  }
  return d;
});

const optionalDate = z
  .string()
  .nullish()
  .transform((s) => {
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  });

const WEEKDAY_FIELDS: Record<Weekday, string> = {
  monday: 'lunes',
  tuesday: 'martes',
  wednesday: 'miercoles',
  thursday: 'jueves',
  friday: 'viernes',
  saturday: 'sabado',
};

export const rawOfferSchema = z.object({
  iddetalle: requiredId,
  idoferta: optionalNumber,
  ige: optionalNumber,
  estado: z.string().min(1),
  descdistrito: z.string().min(1),
  numdistrito: optionalNumber,
  descnivelmodalidad: text,
  nivelmodalidad: text,
  cargo: text,
  descripcionarea: text,
  descripcioncargo: text,
  areaincumbencia: text,
  turno: text,
  supl_revista: text,
  jornada: text,
  hsmodulos: optionalNumber,
  escuela: text,
  domiciliodesempeno: text,
  cursodivision: text,
  supl_desde: optionalDate,
  supl_hasta: optionalDate,
  tomaposesion: optionalDate,
  iniciooferta: requiredDate,
  finoferta: requiredDate,
  lunes: text,
  martes: text,
  miercoles: text,
  jueves: text,
  viernes: text,
  sabado: text,
  observaciones: text,
});

type RawOffer = z.output<typeof rawOfferSchema>;

function parseShifts(value: string): ReadonlySet<Shift> {
  const letters = value.toUpperCase().split('');
  return new Set(SHIFTS.filter((s) => letters.includes(s)));
}

function buildSchedule(raw: RawOffer): Partial<Record<Weekday, string>> {
  const schedule: Partial<Record<Weekday, string>> = {};
  for (const day of WEEKDAYS) {
    const value = raw[WEEKDAY_FIELDS[day] as keyof RawOffer] as string;
    if (value) schedule[day] = value;
  }
  return schedule;
}

function toOffer(raw: RawOffer): Offer {
  const position = [raw.cargo, raw.descripcionarea, raw.descripcioncargo]
    .map(normalizeText)
    .filter((s, i, all) => s !== '' && all.indexOf(s) === i)
    .join(' ');

  return {
    id: raw.iddetalle,
    offerId: raw.idoferta,
    ige: raw.ige,
    status: cleanText(raw.estado),
    districtName: cleanText(raw.descdistrito),
    districtNumber: raw.numdistrito,
    levelName: raw.descnivelmodalidad,
    levelCode: raw.nivelmodalidad,
    position: raw.cargo,
    areaDescription: raw.descripcionarea,
    positionDescription: raw.descripcioncargo,
    areaCode: raw.areaincumbencia.toUpperCase(),
    shifts: parseShifts(raw.turno),
    isSubstitute: raw.supl_revista.toUpperCase() === 'S',
    workday: raw.jornada,
    modules: raw.hsmodulos,
    school: raw.escuela,
    address: raw.domiciliodesempeno,
    courseDivision: raw.cursodivision,
    substituteFrom: raw.supl_desde,
    substituteTo: raw.supl_hasta,
    takesOfficeAt: raw.tomaposesion,
    publishedAt: raw.iniciooferta,
    closesAt: raw.finoferta,
    schedule: buildSchedule(raw),
    notes: raw.observaciones,
    normalized: {
      district: normalizeText(raw.descdistrito),
      level: normalizeText(raw.descnivelmodalidad),
      position,
    },
  };
}

export type ParseOfferResult =
  { ok: true; offer: Offer } | { ok: false; id: unknown; issues: string[] };

/**
 * Validates and normalizes a raw Solr doc. Never throws and never echoes raw values in
 * `issues` (only field paths and messages), so invalid docs can be logged safely.
 */
export function parseOffer(doc: unknown): ParseOfferResult {
  const parsed = rawOfferSchema.safeParse(doc);
  if (parsed.success) return { ok: true, offer: toOffer(parsed.data) };

  const id =
    typeof doc === 'object' && doc !== null && 'iddetalle' in doc
      ? (doc as { iddetalle: unknown }).iddetalle
      : undefined;
  const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  return { ok: false, id, issues };
}
