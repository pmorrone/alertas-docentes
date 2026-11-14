import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({})).toEqual({
      telegramBotToken: undefined,
      pollIntervalMin: 20,
      dbPath: './data/alertas.sqlite',
      maxAlertsPerUser: 3,
      maxUsers: 20,
      adminChatId: undefined,
    });
  });

  it('reads the environment and treats an empty token as unset', () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: '',
      POLL_INTERVAL_MIN: '30',
      DB_PATH: '/x.db',
      MAX_ALERTS_PER_USER: '5',
      MAX_USERS: '12',
      ADMIN_CHAT_ID: '987654321',
    });
    expect(config).toEqual({
      telegramBotToken: undefined,
      pollIntervalMin: 30,
      dbPath: '/x.db',
      maxAlertsPerUser: 5,
      maxUsers: 12,
      adminChatId: 987654321,
    });
  });

  it('treats an empty admin chat id as unset and rejects a non-numeric one', () => {
    expect(loadConfig({ ADMIN_CHAT_ID: '' }).adminChatId).toBeUndefined();
    expect(() => loadConfig({ ADMIN_CHAT_ID: 'pablo' })).toThrow(/ADMIN_CHAT_ID/);
  });

  it('requires room for at least one user', () => {
    expect(() => loadConfig({ MAX_USERS: '0' })).toThrow(/MAX_USERS/);
  });

  it('rejects intervals that would hammer the unofficial API', () => {
    expect(() => loadConfig({ POLL_INTERVAL_MIN: '1' })).toThrow(/POLL_INTERVAL_MIN/);
    expect(() => loadConfig({ POLL_INTERVAL_MIN: 'abc' })).toThrow(/Invalid configuration/);
  });

  it('requires at least one alert per user', () => {
    expect(() => loadConfig({ MAX_ALERTS_PER_USER: '0' })).toThrow(/MAX_ALERTS_PER_USER/);
  });
});
