import { GrammyError } from 'grammy';
import type { Offer } from '../collector/index.js';
import type { Alert, Teacher } from '../db/index.js';
import type { Criteria } from '../matcher/index.js';
import { formatOffer } from './format.js';
import { RecipientUnavailableError, type Notifier } from './types.js';

/** The slice of grammY's `Api` the notifier needs (easy to fake in tests). */
export interface MessageSender {
  sendMessage(
    chatId: number,
    text: string,
    other: {
      parse_mode: 'HTML';
      link_preview_options: { is_disabled: boolean };
      reply_markup: { inline_keyboard: { text: string; url: string }[][] };
    },
  ): Promise<unknown>;
}

/** Telegram says the chat is gone for good (blocked the bot, deleted the account...). */
function isUnreachable(error: unknown): boolean {
  if (!(error instanceof GrammyError)) return false;
  if (error.error_code === 403) return true;
  return error.error_code === 400 && /chat not found|user is deactivated/i.test(error.description);
}

export class TelegramNotifier implements Notifier {
  constructor(
    private readonly sender: MessageSender,
    /** Name for alerts saved before labels existed. */
    private readonly describeCriteria: (criteria: Criteria) => string,
  ) {}

  async notify(teacher: Teacher, offer: Offer, matchedAlerts: readonly Alert[]): Promise<void> {
    const labels = matchedAlerts.map((a) => a.label || this.describeCriteria(a.criteria));
    const { text, url } = formatOffer(offer, labels);
    try {
      await this.sender.sendMessage(teacher.telegramChatId, text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: [[{ text: '🔗 Ver en ABC', url }]] },
      });
    } catch (error) {
      if (isUnreachable(error)) {
        throw new RecipientUnavailableError('telegram chat unavailable', { cause: error });
      }
      throw error;
    }
  }
}
