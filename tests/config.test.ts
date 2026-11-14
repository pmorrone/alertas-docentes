import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({})).toEqual({
      telegramBotToken: undefined,
      pollIntervalMin: 20,
      dbPath: './data/alertas.sqlite',
      maxAlertsPerUser: 3,
    });
  });

  it('reads the environment and treats an empty token as unset', () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: '',
      POLL_INTERVAL_MIN: '30',
      DB_PATH: '/x.db',
      MAX_ALERTS_PER_USER: '5',
    });
    expect(config).toEqual({
      telegramBotToken: undefined,
      pollIntervalMin: 30,
      dbPath: '/x.db',
      maxAlertsPerUser: 5,
    });
  });

  it('rejects intervals that would hammer the unofficial API', () => {
    expect(() => loadConfig({ POLL_INTERVAL_MIN: '1' })).toThrow(/POLL_INTERVAL_MIN/);
    expect(() => loadConfig({ POLL_INTERVAL_MIN: 'abc' })).toThrow(/Invalid configuration/);
  });

  it('requires at least one alert per user', () => {
    expect(() => loadConfig({ MAX_ALERTS_PER_USER: '0' })).toThrow(/MAX_ALERTS_PER_USER/);
  });
});
