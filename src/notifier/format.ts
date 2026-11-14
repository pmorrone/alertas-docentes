import type { Offer, Shift, Weekday } from '../collector/index.js';
import { esc } from '../bot/html.js';

export const APD_URL = 'https://misservicios.abc.gob.ar/actos.publicos.digitales/';

const pad = (n: number): string => String(n).padStart(2, '0');

/*
 * The API labels its timestamps "Z", but they are Argentina wall-clock times: offers are
 * published between 08 and 16 and always close at 07:30 or 10:30 (04:30 would make no
 * sense). So we show the digits as they come instead of converting them. If that ever
 * turns out to be wrong, this is the only place to change.
 */
function formatDay(date: Date): string {
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}`;
}

export function formatApiDateTime(date: Date): string {
  return `${formatDay(date)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export { formatDay as formatApiDay };

/** "GENERAL PUEYRREDON" -> "General Pueyrredon". */
export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(
      /(^|\s)(\p{L})/gu,
      (_m, space: string, letter: string) => space + letter.toUpperCase(),
    );
}

const WEEKDAY_ABBREVIATIONS: Record<Weekday, string> = {
  monday: 'Lun',
  tuesday: 'Mar',
  wednesday: 'Mié',
  thursday: 'Jue',
  friday: 'Vie',
  saturday: 'Sáb',
};

const SHIFT_ORDER: Shift[] = ['M', 'T', 'N'];

function describeSubstitution(offer: Offer): string | undefined {
  if (!offer.isSubstitute) return undefined;
  if (offer.substituteFrom && offer.substituteTo) {
    return `Suplencia del ${formatDay(offer.substituteFrom)} al ${formatDay(offer.substituteTo)}`;
  }
  if (offer.substituteFrom) return `Suplencia desde el ${formatDay(offer.substituteFrom)}`;
  return 'Suplencia';
}

export interface FormattedOffer {
  /** Telegram HTML. */
  text: string;
  url: string;
}

/**
 * The alert sent to a teacher. `alertLabels` are the names of the teacher's alerts that
 * matched, so they know why they got it.
 */
export function formatOffer(offer: Offer, alertLabels: readonly string[]): FormattedOffer {
  const where = [offer.levelName, offer.districtName].filter(Boolean).map(titleCase);
  const title = [`<b>${esc(offer.position || offer.areaDescription)}</b>`, ...where.map(esc)];

  const shifts = SHIFT_ORDER.filter((s) => offer.shifts.has(s));
  const details = [
    offer.courseDivision,
    shifts.length > 0 ? `Turno ${shifts.join('/')}` : '',
    describeSubstitution(offer) ?? '',
    offer.modules !== null ? `Hs/módulos: ${offer.modules}` : '',
  ].filter(Boolean);

  const schedule = (Object.keys(WEEKDAY_ABBREVIATIONS) as Weekday[])
    .filter((day) => offer.schedule[day])
    .map((day) => `${WEEKDAY_ABBREVIATIONS[day]} ${offer.schedule[day]}`);

  const place = [
    offer.address ? titleCase(offer.address) : '',
    offer.school ? `(${offer.school})` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const lines = [
    `🆕 ${title.join(', ')}`,
    details.length > 0 ? esc(details.join(' · ')) : '',
    schedule.length > 0 ? esc(schedule.join(' · ')) : '',
    place ? `📍 ${esc(place)}` : '',
    offer.notes
      ? `📝 ${esc(offer.notes.length > 200 ? `${offer.notes.slice(0, 199)}…` : offer.notes)}`
      : '',
    `⏰ Cierra: ${formatApiDateTime(offer.closesAt)}`,
    alertLabels.length > 0
      ? `🔔 ${alertLabels.length === 1 ? 'Tu alerta' : 'Tus alertas'}: ${alertLabels.map(esc).join(' · ')}`
      : '',
  ];
  return { text: lines.filter(Boolean).join('\n'), url: APD_URL };
}
