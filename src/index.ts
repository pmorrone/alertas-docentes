import { SolrClient } from './collector/index.js';
import { loadConfig } from './config.js';
import { createSqliteRepositories, openDatabase } from './db/index.js';
import { consoleLogger as logger } from './logger.js';
import { LogNotifier } from './notifier/log-notifier.js';
import { runCycle, startScheduler } from './scheduler.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const deps = {
  collector: new SolrClient(),
  repos: createSqliteRepositories(db),
  // Replaced by the Telegram notifier in step 5.
  notifier: new LogNotifier(logger),
  logger,
};

logger.info(`starting: polling every ${config.pollIntervalMin} min, db ${config.dbPath}`);
const scheduler = startScheduler({
  intervalMs: config.pollIntervalMin * 60_000,
  logger,
  cycle: async () => {
    const report = await runCycle(deps);
    logger.info(`cycle done: ${JSON.stringify(report)}`);
  },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info(`${signal} received, shutting down`);
    void scheduler.stop().then(() => {
      db.close();
      process.exit(0);
    });
  });
}
