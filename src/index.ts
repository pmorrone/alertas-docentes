import { createBotService } from './bot/service.js';
import { createTelegramBot } from './bot/telegram.js';
import { SolrClient } from './collector/index.js';
import { loadConfig } from './config.js';
import { createSqliteRepositories, openDatabase } from './db/index.js';
import { consoleLogger as logger } from './logger.js';
import { LogNotifier } from './notifier/log-notifier.js';
import { TelegramNotifier } from './notifier/telegram-notifier.js';
import type { Notifier } from './notifier/types.js';
import { describeCriteria, loadCatalog, loadInterpreter } from './nlu/index.js';
import { runCycle, startScheduler } from './scheduler.js';
import { createOfferSearch } from './search/offer-search.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const repos = createSqliteRepositories(db);
const catalog = loadCatalog();
const collector = new SolrClient();
const describe = (criteria: Parameters<typeof describeCriteria>[0]): string =>
  describeCriteria(criteria, catalog);

let notifier: Notifier;
let stopBot: () => Promise<void> = async () => undefined;

if (config.telegramBotToken) {
  const service = createBotService({
    repos,
    search: createOfferSearch({ collector }),
    interpreter: loadInterpreter(),
    maxAlertsPerUser: config.maxAlertsPerUser,
    describeCriteria: describe,
  });
  const bot = createTelegramBot(config.telegramBotToken, service, { logger });
  notifier = new TelegramNotifier(bot.api, describe);
  stopBot = () => bot.stop();
  // Long polling: runs until `bot.stop()`. Not awaited on purpose.
  bot
    .start({ onStart: (me) => logger.info(`telegram bot @${me.username} is up`) })
    .catch((error: unknown) =>
      logger.error(`telegram bot stopped: ${error instanceof Error ? error.message : 'unknown'}`),
    );
} else {
  logger.warn('TELEGRAM_BOT_TOKEN is not set: no bot, alerts are only logged');
  notifier = new LogNotifier(logger);
}

logger.info(`starting: polling every ${config.pollIntervalMin} min, db ${config.dbPath}`);
const scheduler = startScheduler({
  intervalMs: config.pollIntervalMin * 60_000,
  logger,
  cycle: async () => {
    const report = await runCycle({ collector, repos, notifier, logger });
    logger.info(`cycle done: ${JSON.stringify(report)}`);
  },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info(`${signal} received, shutting down`);
    void Promise.all([scheduler.stop(), stopBot()]).then(() => {
      db.close();
      process.exit(0);
    });
  });
}
