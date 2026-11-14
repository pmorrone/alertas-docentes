import type { Bot } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBotService } from '../../src/bot/service.js';
import { createTelegramBot } from '../../src/bot/telegram.js';
import {
  createSqliteRepositories,
  openDatabase,
  type Db,
  type Repositories,
} from '../../src/db/index.js';
import { silentLogger } from '../../src/logger.js';
import { describeCriteria } from '../../src/nlu/index.js';
import { catalog, interpreter } from '../nlu/helpers.js';

const botInfo = {
  id: 999,
  is_bot: true,
  first_name: 'Alertas',
  username: 'alertas_test_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as UserFromGetMe;

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

describe('telegram wiring (grammY)', () => {
  let db: Db;
  let repos: Repositories;
  let bot: Bot;
  let calls: ApiCall[];
  let updateId = 0;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    repos = createSqliteRepositories(db);
    const service = createBotService({
      repos,
      search: { findMatching: async () => ({ total: 0, offers: [] }) },
      interpreter,
      maxAlertsPerUser: 3,
      describeCriteria: (c) => describeCriteria(c, catalog),
    });
    bot = createTelegramBot('123:fake-token', service, { logger: silentLogger, botInfo });
    calls = [];
    // Fake Telegram: record every API call and always answer "ok".
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      return { ok: true, result: method === 'sendMessage' ? { message_id: 1 } : true } as never;
    });
    await bot.init();
  });
  afterEach(() => db.close());

  /** Same path long polling uses, so `bot.catch` is exercised too. */
  // `handleUpdates` is internal in grammY's types, but it is what long polling calls.
  const deliver = (update: Update) =>
    (bot as unknown as { handleUpdates(updates: Update[]): Promise<void> }).handleUpdates([update]);

  const chat = (id = 42, type: 'private' | 'group' = 'private') => ({
    id,
    type,
    first_name: 'Test',
  });
  const from = (id = 42) => ({ id, is_bot: false, first_name: 'Test' });

  const sendText = (text: string, id = 42, type: 'private' | 'group' = 'private') =>
    deliver({
      update_id: ++updateId,
      message: {
        message_id: updateId,
        date: 0,
        chat: chat(id, type),
        from: from(id),
        text,
        ...(text.startsWith('/')
          ? { entities: [{ type: 'bot_command' as const, offset: 0, length: text.length }] }
          : {}),
      },
    } as Update);

  const tap = (data: string, id = 42) =>
    deliver({
      update_id: ++updateId,
      callback_query: {
        id: String(updateId),
        chat_instance: 'x',
        from: from(id),
        data,
        message: { message_id: 1, date: 0, chat: chat(id), text: 'old' },
      },
    } as Update);

  const sent = (): ApiCall[] => calls.filter((c) => c.method === 'sendMessage');
  const lastText = (): string => String(sent().at(-1)?.payload.text);
  const lastKeyboard = (): { text: string; callback_data: string }[][] =>
    (sent().at(-1)?.payload.reply_markup as { inline_keyboard: never } | undefined)
      ?.inline_keyboard ?? [];

  it('/start registers the teacher and replies in HTML', async () => {
    await sendText('/start');

    expect(await repos.teachers.findByChatId(42)).toMatchObject({ active: true });
    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.payload).toMatchObject({ chat_id: 42, parse_mode: 'HTML' });
    expect(lastText()).toContain('alertas APD');
  });

  it('handles commands with the bot name suffix and unknown commands', async () => {
    await sendText('/ver@alertas_test_bot');
    expect(lastText()).toContain('Todavía no tenés alertas');

    await sendText('/lo-que-sea');
    expect(lastText()).toContain('Cómo funciona');
  });

  it('runs a full conversation: text, inline buttons, confirmation', async () => {
    await sendText('historia en pilar a la tarde');

    expect(lastText()).toContain('Historia · Pilar · Tarde');
    expect(
      lastKeyboard()
        .flat()
        .map((b) => b.callback_data),
    ).toEqual(['ok', 'edit']);

    await tap('ok');

    expect(lastText()).toContain('Listo');
    expect(calls.map((c) => c.method)).toContain('answerCallbackQuery');
    expect(calls.map((c) => c.method)).toContain('editMessageReplyMarkup'); // buttons removed
    const teacher = (await repos.teachers.findByChatId(42))!;
    expect(await repos.alerts.listByTeacher(teacher.id)).toHaveLength(1);
  });

  it('renders link buttons as URL buttons and the others as callback buttons', async () => {
    await sendText('qué hay de historia en pilar');

    const keyboard = lastKeyboard() as unknown as {
      text: string;
      url?: string;
      callback_data?: string;
    }[][];
    expect(keyboard[0]![0]).toMatchObject({
      text: '🔗 Ver en ABC',
      url: 'https://misservicios.abc.gob.ar/actos.publicos.digitales/',
    });
    expect(keyboard[1]![0]).toMatchObject({ callback_data: 'mkalert' });
  });

  it('turns a failure into a friendly message instead of silence', async () => {
    db.close();
    await sendText('historia en pilar');
    expect(lastText()).toContain('algo salió mal');
    db = openDatabase(':memory:'); // so afterEach can close it
  });

  it('tells voice senders that audio is not supported yet', async () => {
    await deliver({
      update_id: ++updateId,
      message: {
        message_id: 1,
        date: 0,
        chat: chat(),
        from: from(),
        voice: { file_id: 'f', file_unique_id: 'u', duration: 3 },
      },
    } as Update);

    expect(lastText()).toContain('Todavía no puedo escuchar audios');
  });

  it('ignores groups', async () => {
    await sendText('/start', 77, 'group');

    expect(calls).toHaveLength(0);
    expect(await repos.teachers.findByChatId(77)).toBeUndefined();
  });
});
