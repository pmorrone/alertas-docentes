import { z } from 'zod';

const configSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  /** The API is unofficial: stay polite, at most one poll every 5 minutes. */
  POLL_INTERVAL_MIN: z.coerce.number().int().min(5).default(20),
  /** Pilot default: 3 alerts per teacher. */
  MAX_ALERTS_PER_USER: z.coerce.number().int().min(1).default(3),
  DB_PATH: z.string().min(1).default('./data/alertas.sqlite'),
});

export interface Config {
  telegramBotToken: string | undefined;
  pollIntervalMin: number;
  dbPath: string;
  maxAlertsPerUser: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration: ${problems.join('; ')}`);
  }
  return {
    telegramBotToken: parsed.data.TELEGRAM_BOT_TOKEN || undefined,
    pollIntervalMin: parsed.data.POLL_INTERVAL_MIN,
    dbPath: parsed.data.DB_PATH,
    maxAlertsPerUser: parsed.data.MAX_ALERTS_PER_USER,
  };
}
