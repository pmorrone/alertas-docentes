import { AlertLimitError, type Alert, type Repositories, type Teacher } from '../db/index.js';
import type { Criteria } from '../matcher/index.js';
import type { Interpretation, Interpreter, Question } from '../nlu/index.js';
import { alertMatchesFilter, isEmptyFilter, sameCriteria } from './alert-filter.js';
import { esc, truncate } from './html.js';
import * as texts from './texts.js';
import type { BotReply, Button } from './types.js';

export interface BotServiceDeps {
  repos: Repositories;
  interpreter: Interpreter;
  maxAlertsPerUser: number;
  /** Fallback name for alerts saved before labels existed. */
  describeCriteria: (criteria: Criteria) => string;
  now?: () => Date;
  /** How long a half-finished conversation is remembered. */
  pendingTtlMs?: number;
}

export type Command = 'start' | 'help' | 'list' | 'pause' | 'resume' | 'leave';

/** What the bot is waiting for from this chat. Lives in memory only. */
type Pending =
  { type: 'question'; question: Question } | { type: 'confirm'; criteria: Criteria; label: string };

/**
 * The bot's brain: turns messages and button taps into replies. It knows nothing about
 * Telegram or grammY, so it is tested with plain strings.
 */
export interface BotService {
  command(chatId: number, command: Command): Promise<BotReply[]>;
  text(chatId: number, text: string): Promise<BotReply[]>;
  callback(chatId: number, data: string): Promise<BotReply[]>;
  voice(): BotReply[];
}

const say = (text: string, buttons?: Button[][]): BotReply =>
  buttons ? { text, buttons } : { text };

const labelOf = (alert: Alert, describe: (c: Criteria) => string): string =>
  alert.label || describe(alert.criteria);

export function createBotService(deps: BotServiceDeps): BotService {
  const { repos, interpreter, maxAlertsPerUser: max, describeCriteria } = deps;
  const now = deps.now ?? (() => new Date());
  const ttl = deps.pendingTtlMs ?? 30 * 60_000;
  const pending = new Map<number, { value: Pending; expiresAt: number }>();

  const setPending = (chatId: number, value: Pending): void => {
    pending.set(chatId, { value, expiresAt: now().getTime() + ttl });
  };
  const clearPending = (chatId: number): void => {
    pending.delete(chatId);
  };
  const getPending = (chatId: number): Pending | undefined => {
    const entry = pending.get(chatId);
    if (!entry) return undefined;
    if (entry.expiresAt <= now().getTime()) {
      pending.delete(chatId);
      return undefined;
    }
    return entry.value;
  };

  const ensureTeacher = (chatId: number): Promise<Teacher> =>
    repos.teachers.upsertByChatId(chatId, now());

  // ---- rendering --------------------------------------------------------------------------

  async function listReplies(teacher: Teacher): Promise<BotReply[]> {
    const alerts = await repos.alerts.listByTeacher(teacher.id);
    if (alerts.length === 0) return [say(texts.NO_ALERTS)];

    const lines = alerts.map(
      (a, i) =>
        `${i + 1}. ${a.active ? '▶️' : '⏸'} ${esc(labelOf(a, describeCriteria))}${a.active ? '' : ' (pausada)'}`,
    );
    const rows: Button[][] = alerts.map((a, i) => [
      a.active
        ? { text: `⏸ Pausar ${i + 1}`, data: `pause:${a.id}` }
        : { text: `▶️ Reanudar ${i + 1}`, data: `resume:${a.id}` },
      { text: `🗑 Borrar ${i + 1}`, data: `del:${a.id}` },
    ]);
    const header = `<b>Tus alertas</b> (${alerts.length} de ${max})`;
    const warning = teacher.active ? [] : ['', texts.ALL_PAUSED_WARNING];
    return [say([header, '', ...lines, ...warning].join('\n'), rows)];
  }

  const deleteChoices = (alerts: Alert[]): Button[][] =>
    alerts.map((a) => [
      { text: `🗑 ${truncate(labelOf(a, describeCriteria))}`, data: `del:${a.id}` },
    ]);

  async function renderDelete(
    teacher: Teacher,
    result: Extract<Interpretation, { kind: 'delete' }>,
  ): Promise<BotReply[]> {
    const alerts = await repos.alerts.listByTeacher(teacher.id);
    if (alerts.length === 0) return [say('No tenés alertas para borrar.')];

    if (result.all) {
      return [
        say(`¿Borro tus ${alerts.length} alertas?`, [
          [
            { text: '🗑 Sí, borrar todas', data: 'delallok' },
            { text: 'Cancelar', data: 'cancel' },
          ],
        ]),
      ];
    }
    if (isEmptyFilter(result.filter)) {
      return [say('¿Cuál querés borrar?', deleteChoices(alerts))];
    }

    const found = alerts.filter((a) => alertMatchesFilter(a.criteria, result.filter));
    const [only] = found;
    if (found.length === 1 && only) {
      return [
        say(`¿Borro esta alerta?\n<b>${esc(labelOf(only, describeCriteria))}</b>`, [
          [
            { text: '🗑 Sí, borrar', data: `delok:${only.id}` },
            { text: 'Cancelar', data: 'cancel' },
          ],
        ]),
      ];
    }
    if (found.length > 1) {
      return [say('Encontré varias parecidas. ¿Cuál querés borrar?', deleteChoices(found))];
    }
    return [
      say(
        `No encontré una alerta como «${esc(result.summary)}». ¿Querés borrar alguna de estas?`,
        deleteChoices(alerts),
      ),
    ];
  }

  async function renderCreate(
    teacher: Teacher,
    chatId: number,
    result: Extract<Interpretation, { kind: 'create' }>,
  ): Promise<BotReply[]> {
    const alerts = await repos.alerts.listByTeacher(teacher.id);
    const existing = alerts.find((a) => sameCriteria(a.criteria, result.criteria));
    if (existing) {
      return [say(texts.duplicate(labelOf(existing, describeCriteria)))];
    }
    if (alerts.length >= max) {
      return [say(texts.limitReached(max), deleteChoices(alerts))];
    }
    setPending(chatId, { type: 'confirm', criteria: result.criteria, label: result.summary });
    return [
      say(texts.confirmCreate(result.summary, result.notes), [
        [
          { text: '✅ Sí', data: 'ok' },
          { text: '✏️ Cambiar', data: 'edit' },
        ],
      ]),
    ];
  }

  async function render(
    teacher: Teacher,
    chatId: number,
    result: Interpretation,
  ): Promise<BotReply[]> {
    switch (result.kind) {
      case 'create':
        clearPending(chatId);
        return renderCreate(teacher, chatId, result);
      case 'question': {
        setPending(chatId, { type: 'question', question: result });
        const buttons = result.options.map((o, i) => [{ text: truncate(o.label), data: `q:${i}` }]);
        return [say(esc(result.text), buttons.length > 0 ? buttons : undefined)];
      }
      case 'view':
        clearPending(chatId);
        return listReplies(teacher);
      case 'delete':
        clearPending(chatId);
        return renderDelete(teacher, result);
      case 'help':
        clearPending(chatId);
        return [say(texts.help(max))];
      case 'unknown':
        return [say(texts.NOT_UNDERSTOOD)];
    }
  }

  // ---- entry points -----------------------------------------------------------------------

  async function command(chatId: number, name: Command): Promise<BotReply[]> {
    const teacher = await ensureTeacher(chatId);
    switch (name) {
      case 'start':
        clearPending(chatId);
        return [say(texts.welcome(max))];
      case 'help':
        return [say(texts.help(max))];
      case 'list':
        clearPending(chatId);
        return listReplies(teacher);
      case 'pause':
        await repos.teachers.setActive(teacher.id, false);
        return [say(texts.pausedAll)];
      case 'resume':
        await repos.teachers.setActive(teacher.id, true);
        return [say(texts.resumedAll)];
      case 'leave':
        return [
          say(texts.confirmLeave, [
            [
              { text: '🗑 Sí, borrar todo', data: 'leaveok' },
              { text: 'Cancelar', data: 'cancel' },
            ],
          ]),
        ];
    }
  }

  async function text(chatId: number, message: string): Promise<BotReply[]> {
    const teacher = await ensureTeacher(chatId);
    const current = getPending(chatId);

    // In the middle of a question, "mis alertas" or "ayuda" still do what they say.
    if (current?.type === 'question') {
      const alone = interpreter.interpret(message);
      if (alone.kind === 'view' || alone.kind === 'help') return render(teacher, chatId, alone);
      return render(teacher, chatId, interpreter.interpret(message, current.question.state));
    }
    return render(teacher, chatId, interpreter.interpret(message));
  }

  async function callback(chatId: number, data: string): Promise<BotReply[]> {
    const teacher = await ensureTeacher(chatId);
    const [action = '', arg] = data.split(':');
    const id = arg === undefined ? NaN : Number(arg);
    const current = getPending(chatId);

    switch (action) {
      case 'q': {
        if (current?.type !== 'question' || !Number.isInteger(id)) return [say(texts.EXPIRED)];
        return render(teacher, chatId, interpreter.answer(current.question, id));
      }
      case 'ok': {
        if (current?.type !== 'confirm') return [say(texts.EXPIRED)];
        clearPending(chatId);
        try {
          await repos.alerts.create(teacher.id, current.criteria, now(), max, current.label);
        } catch (error) {
          if (error instanceof AlertLimitError) return [say(texts.limitReached(max))];
          throw error;
        }
        const count = (await repos.alerts.listByTeacher(teacher.id)).length;
        return [say(texts.created(current.label, count, max))];
      }
      case 'edit':
        clearPending(chatId);
        return [say(texts.EDIT_PROMPT)];
      case 'cancel':
        clearPending(chatId);
        return [say(texts.NOTHING_CHANGED)];
    }

    if (action === 'delallok') {
      const alerts = await repos.alerts.listByTeacher(teacher.id);
      for (const alert of alerts) await repos.alerts.delete(alert.id);
      return [
        say(
          `🗑 Listo, borré ${alerts.length === 1 ? 'tu alerta' : `tus ${alerts.length} alertas`}.`,
        ),
      ];
    }

    // Everything below acts on one alert, which must belong to this teacher.
    const alert = Number.isInteger(id) ? await repos.alerts.find(id) : undefined;
    if (!alert || alert.teacherId !== teacher.id) return [say(texts.EXPIRED)];
    const label = esc(labelOf(alert, describeCriteria));

    switch (action) {
      case 'pause':
      case 'resume': {
        await repos.alerts.setActive(alert.id, action === 'resume');
        return listReplies(teacher);
      }
      case 'del':
        return [
          say(`¿Borro esta alerta?\n<b>${label}</b>`, [
            [
              { text: '🗑 Sí, borrar', data: `delok:${alert.id}` },
              { text: 'Cancelar', data: 'cancel' },
            ],
          ]),
        ];
      case 'delok':
        await repos.alerts.delete(alert.id);
        return [say(`🗑 Borrada: <b>${label}</b>`)];
      default:
        return [say(texts.EXPIRED)];
    }
  }

  return {
    command,
    text,
    callback: async (chatId, data) => {
      // "leaveok" needs the teacher record deleted, so it is handled before it is re-created.
      if (data === 'leaveok') {
        const teacher = await repos.teachers.findByChatId(chatId);
        if (teacher) await repos.teachers.delete(teacher.id);
        clearPending(chatId);
        return [say(texts.left)];
      }
      return callback(chatId, data);
    },
    voice: () => [say(texts.VOICE_NOT_YET)],
  };
}
