import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({})).toEqual({
      telegramBotToken: undefined,
      pollIntervalMin: 20,
      dbPath: './data/alertas.sqlite',
    });
  });

  it('reads the environment and treats an empty token as unset', () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: '',
      POLL_INTERVAL_MIN: '30',
      DB_PATH: '/x.db',
    });
    expect(config).toEqual({ telegramBotToken: undefined, pollIntervalMin: 30, dbPath: '/x.db' });
  });

  it('rejects intervals that would hammer the unofficial API', () => {
    expect(() => loadConfig({ POLL_INTERVAL_MIN: '1' })).toThrow(/POLL_INTERVAL_MIN/);
    expect(() => loadConfig({ POLL_INTERVAL_MIN: 'abc' })).toThrow(/Invalid configuration/);
  });
});
