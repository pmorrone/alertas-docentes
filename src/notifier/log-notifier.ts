import type { Offer } from '../collector/index.js';
import type { Alert, Teacher } from '../db/index.js';
import type { Logger } from '../logger.js';
import type { Notifier } from './types.js';

/** Placeholder until the Telegram notifier exists: only logs what it would send. */
export class LogNotifier implements Notifier {
  constructor(private readonly logger: Logger) {}

  async notify(teacher: Teacher, offer: Offer, matchedAlerts: readonly Alert[]): Promise<void> {
    this.logger.info(
      `[notify] teacher ${teacher.id} <- offer ${offer.id} (${offer.position}) via alerts ${matchedAlerts.map((a) => a.id).join(',')}`,
    );
  }
}
