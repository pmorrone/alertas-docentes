import { GrammyError } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import type { Alert, Teacher } from '../../src/db/index.js';
import { createCriteria } from '../../src/matcher/index.js';
import { APD_URL } from '../../src/notifier/format.js';
import { TelegramNotifier, type MessageSender } from '../../src/notifier/telegram-notifier.js';
import { RecipientUnavailableError } from '../../src/notifier/types.js';
import { makeOffer } from '../matcher/helpers.js';

const teacher: Teacher = {
  id: 7,
  telegramChatId: 555,
  active: true,
  createdAt: new Date('2026-11-01T00:00:00Z'),
};
const alert = (label: string): Alert => ({
  id: 1,
  teacherId: 7,
  criteria: createCriteria({ districts: ['pilar'] }),
  label,
  active: true,
  createdAt: new Date('2026-11-01T00:00:00Z'),
});

const apiError = (code: number, description: string) =>
  new GrammyError(
    'Call to sendMessage failed',
    { ok: false, error_code: code, description },
    'sendMessage',
    {},
  );

function notifierWith(send: MessageSender['sendMessage']) {
  const sender: MessageSender = { sendMessage: send };
  return new TelegramNotifier(sender, () => 'descripción de respaldo');
}

describe('TelegramNotifier', () => {
  it('sends the alert as HTML with a "Ver en ABC" button', async () => {
    const send = vi.fn<MessageSender['sendMessage']>().mockResolvedValue({});

    await notifierWith(send).notify(teacher, makeOffer(), [alert('Danza · Pilar')]);

    expect(send).toHaveBeenCalledOnce();
    const [chatId, text, options] = send.mock.calls[0]!;
    expect(chatId).toBe(555);
    expect(text).toContain('Maestro de Danza Primaria (MDP)');
    expect(text).toContain('🔔 Tu alerta: Danza · Pilar');
    expect(options).toMatchObject({
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: '🔗 Ver en ABC', url: APD_URL }]] },
    });
  });

  it('describes alerts that were saved without a label', async () => {
    const send = vi.fn<MessageSender['sendMessage']>().mockResolvedValue({});

    await notifierWith(send).notify(teacher, makeOffer(), [alert('')]);

    expect(send.mock.calls[0]![1]).toContain('descripción de respaldo');
  });

  it.each([
    [403, 'Forbidden: bot was blocked by the user'],
    [400, 'Bad Request: chat not found'],
    [400, 'Bad Request: user is deactivated'],
  ])('reports an unreachable recipient on %i "%s"', async (code, description) => {
    const send = vi
      .fn<MessageSender['sendMessage']>()
      .mockRejectedValue(apiError(code, description));

    await expect(notifierWith(send).notify(teacher, makeOffer(), [])).rejects.toBeInstanceOf(
      RecipientUnavailableError,
    );
  });

  it('lets transient errors through so the scheduler retries', async () => {
    const rateLimited = apiError(429, 'Too Many Requests: retry after 5');
    const network = new Error('socket hang up');

    for (const error of [rateLimited, network, apiError(400, 'Bad Request: message is too long')]) {
      const send = vi.fn<MessageSender['sendMessage']>().mockRejectedValue(error);
      const failure = await notifierWith(send)
        .notify(teacher, makeOffer(), [])
        .catch((e: unknown) => e);
      expect(failure).toBe(error);
    }
  });
});
