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

const LOWERCASE_WORDS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e']);

/** "GENERAL PUEYRREDON" -> "General Pueyrredon", "LOMAS DE ZAMORA" -> "Lomas de Zamora". */
export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word, index) =>
      index > 0 && LOWERCASE_WORDS.has(word)
        ? word
        : word.replace(/^\p{L}/u, (c) => c.toUpperCase()),
    )
    .join(' ');
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
export function formatOffer(
  offer: Offer,
  alertLabels: readonly string[],
  /** Bullet at the start of the title; lists use a quieter one than "new". */
  icon = '🆕',
): FormattedOffer {
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
    `${icon} ${title.join(', ')}`,
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

/** Telegram rejects messages over 4096 characters; stay well under. */
const MAX_LIST_CHARS = 3500;

export interface FormattedSearch {
  text: string;
  /** How many offers fit in the message. */
  shown: number;
}

/**
 * Several offers in one message (they all link to the same APD site, so one button is
 * enough and the chat is not flooded). Stops adding offers when the message gets long.
 */
export function formatSearchResults(
  offers: readonly Offer[],
  total: number,
  label: string,
): FormattedSearch {
  if (total === 0) {
    return { text: `🔎 Ahora no hay ofertas publicadas para <b>${esc(label)}</b>.`, shown: 0 };
  }

  const head = `🔎 <b>${total === 1 ? '1 oferta publicada' : `${total} ofertas publicadas`}</b> ahora para <b>${esc(label)}</b>:`;
  const blocks: string[] = [];
  let length = head.length;
  for (const offer of offers) {
    const block = formatOffer(offer, [], '▫️').text;
    if (blocks.length > 0 && length + block.length > MAX_LIST_CHARS) break;
    blocks.push(block);
    length += block.length + 2;
  }

  const rest = total - blocks.length;
  const tail = rest > 0 ? [`… y ${rest} más. Las ves todas en el sitio de APD.`] : [];
  return { text: [head, ...blocks, ...tail].join('\n\n'), shown: blocks.length };
}
