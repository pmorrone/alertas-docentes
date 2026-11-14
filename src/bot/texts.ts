import { esc } from './html.js';

/** Messages for teachers, in Spanish. */

export const EXAMPLES = [
  '«historia en Tandil a la mañana»',
  '«suplencias de inglés en Pilar»',
  '«primaria en General Pueyrredon»',
];

export const welcome = (maxAlerts: number): string =>
  [
    '👋 ¡Hola! Soy el bot de <b>alertas APD</b>. Te aviso por acá cuando la DGCyE publica una oferta de Actos Públicos Digitales que coincide con lo que buscás.',
    '',
    'Contame qué buscás, escribiéndolo como te salga. Por ejemplo:',
    ...EXAMPLES.map((e) => `• ${e}`),
    '',
    `Podés tener hasta ${maxAlerts} alertas. Por ahora escribime; los audios vienen pronto.`,
    '',
    'Comandos: /ver /pausar /reanudar /baja /ayuda',
  ].join('\n');

export const help = (maxAlerts: number): string =>
  [
    '<b>Cómo funciona</b>',
    'Escribime qué cargos querés y dónde, y te aviso apenas se publiquen. Ejemplos:',
    ...EXAMPLES.map((e) => `• ${e}`),
    '',
    `Podés tener hasta ${maxAlerts} alertas a la vez.`,
    '• «mostrame mis alertas» o /ver: ver, pausar o borrar alertas',
    '• «borrá la de geografía»: borrar una alerta',
    '• /pausar y /reanudar: frenar o retomar todos los avisos',
    '• /baja: borrar todos tus datos',
  ].join('\n');

export const NOT_UNDERSTOOD = `No te entendí 🤔. Contame qué buscás, por ejemplo ${EXAMPLES[0]}, o escribí /ayuda.`;

export const VOICE_NOT_YET =
  '🎙️ Todavía no puedo escuchar audios, pero ya viene. Por ahora escribime qué buscás.';

export const EXPIRED = 'Esa opción ya no está disponible. Contame de nuevo qué buscás y seguimos.';

export const EDIT_PROMPT = 'Dale, contame de nuevo qué querés que busque.';
export const NOTHING_CHANGED = 'Listo, no hice ningún cambio.';
export const NO_ALERTS =
  'Todavía no tenés alertas. Contame qué buscás, por ejemplo ' + EXAMPLES[0] + '.';

export const confirmCreate = (label: string, notes: readonly string[]): string =>
  [
    'Voy a avisarte de ofertas de:',
    `<b>${esc(label)}</b>`,
    ...notes.map((n) => `ℹ️ ${esc(n)}`),
    '',
    '¿Confirmás?',
  ].join('\n');

export const created = (label: string, count: number, max: number): string =>
  `✅ Listo, te aviso de: <b>${esc(label)}</b>\n(${count} de ${max} alertas)`;

export const limitReached = (max: number): string =>
  `Ya tenés ${max} alertas, que es el máximo. Borrá una para crear otra:`;

export const duplicate = (label: string): string => `Ya tenés esa alerta: <b>${esc(label)}</b>.`;

export const pausedAll =
  '⏸ Listo, pausé todos tus avisos. Cuando quieras retomarlos, usá /reanudar.';
export const resumedAll = '▶️ Listo, retomé tus avisos.';
export const ALL_PAUSED_WARNING = '⚠️ Tenés los avisos pausados. Usá /reanudar para recibirlos.';

export const confirmLeave =
  'Esto borra tus alertas y todos tus datos, y dejo de avisarte. ¿Seguro?';
export const left =
  'Listo, borré todos tus datos. Si querés volver, escribime /start cuando quieras. ¡Suerte!';
