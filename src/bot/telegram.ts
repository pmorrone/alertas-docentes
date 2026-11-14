import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { Logger } from '../logger.js';
import type { BotService, Command } from './service.js';
import type { BotReply } from './types.js';

export interface TelegramBotOptions {
  logger: Logger;
  /** Skips the `getMe` call at startup; used by tests. */
  botInfo?: UserFromGetMe;
}

const COMMANDS: Record<string, Command> = {
  start: 'start',
  ayuda: 'help',
  help: 'help',
  ver: 'list',
  pausar: 'pause',
  reanudar: 'resume',
  baja: 'leave',
};

const GENERIC_ERROR = 'Ups, algo salió mal de mi lado 😅. Probá de nuevo en un rato.';

async function send(ctx: Context, replies: readonly BotReply[]): Promise<void> {
  for (const reply of replies) {
    const keyboard = reply.buttons
      ? reply.buttons.reduce((kb, row) => {
          row.forEach((b) => kb.text(b.text, b.data));
          return kb.row();
        }, new InlineKeyboard())
      : undefined;
    await ctx.reply(reply.text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  }
}

/** Connects grammY to the `BotService`. It only translates; the logic lives in the service. */
export function createTelegramBot(
  token: string,
  service: BotService,
  { logger, botInfo }: TelegramBotOptions,
): Bot {
  const bot = new Bot(token, botInfo ? { botInfo } : {});

  // Alerts are personal: ignore groups and channels.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type === 'private') await next();
  });

  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    if (text.startsWith('/')) {
      const name = text.slice(1).split(/[\s@]/, 1)[0]?.toLowerCase() ?? '';
      const command = COMMANDS[name];
      await send(
        ctx,
        await (command ? service.command(chatId, command) : service.command(chatId, 'help')),
      );
      return;
    }
    await send(ctx, await service.text(chatId, text));
  });

  bot.on('message:voice', async (ctx) => send(ctx, service.voice()));

  bot.on('callback_query:data', async (ctx) => {
    // Stop the spinner, and remove the buttons so a second tap cannot repeat the action.
    await ctx.answerCallbackQuery().catch(() => undefined);
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    await send(ctx, await service.callback(chatId, ctx.callbackQuery.data));
  });

  bot.catch(async (error) => {
    // Never log the message text: it is personal.
    logger.error(`bot error: ${error.error instanceof Error ? error.error.message : 'unknown'}`);
    await error.ctx.reply(GENERIC_ERROR).catch(() => undefined);
  });

  return bot;
}
