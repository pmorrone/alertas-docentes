import type { Offer } from '../collector/index.js';
import type { Teacher } from '../db/index.js';

/** Thrown when the recipient can no longer be reached (e.g. they blocked the bot). */
export class RecipientUnavailableError extends Error {
  constructor(message = 'recipient unavailable', options?: ErrorOptions) {
    super(message, options);
    this.name = 'RecipientUnavailableError';
  }
}

export interface Notifier {
  /**
   * Delivers one alert. Resolves only when it was delivered. Throws
   * `RecipientUnavailableError` for permanent failures and any other error for transient ones.
   */
  notify(teacher: Teacher, offer: Offer): Promise<void>;
}
