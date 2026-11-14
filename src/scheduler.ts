import type { CollectResult, Offer } from './collector/index.js';
import type { Repositories } from './db/index.js';
import type { Logger } from './logger.js';
import { matches } from './matcher/index.js';
import { RecipientUnavailableError, type Notifier } from './notifier/types.js';

export interface CycleDeps {
  collector: { fetchPublishedOffers(): Promise<CollectResult> };
  repos: Repositories;
  notifier: Notifier;
  logger: Logger;
  now?: () => Date;
  /**
   * The very first cycle sees every published offer as "new". By default that baseline is
   * recorded silently so nobody gets flooded with offers that were already there.
   */
  notifyOnBaseline?: boolean;
}

export interface CycleReport {
  collected: number;
  newOffers: number;
  /** True when the database had no seen offers and the cycle only recorded a baseline. */
  baseline: boolean;
  sent: number;
  failed: number;
  /** Teachers paused because Telegram says they cannot be reached. */
  deactivated: number;
}

/**
 * One scheduler cycle: collect -> keep new offers -> match -> notify.
 *
 * Delivery guarantees:
 * - A (teacher, offer) pair is never notified twice (`notifications` table).
 * - An offer is marked as seen only when every matching teacher was served (or permanently
 *   unreachable). If a send fails transiently the offer stays "new" and is retried next
 *   cycle; teachers that already got it are skipped. A crash between sending and recording
 *   can duplicate one alert (at-least-once).
 */
export async function runCycle(deps: CycleDeps): Promise<CycleReport> {
  const { collector, repos, notifier, logger } = deps;
  const now = deps.now ?? (() => new Date());

  const { offers } = await collector.fetchPublishedOffers();
  const seen = await repos.seenOffers.findSeenIds(offers.map((o) => o.id));
  const fresh = offers.filter((o) => !seen.has(o.id));
  const report: CycleReport = {
    collected: offers.length,
    newOffers: fresh.length,
    baseline: false,
    sent: 0,
    failed: 0,
    deactivated: 0,
  };

  if (fresh.length === 0) return report;

  if ((await repos.seenOffers.count()) === 0 && !deps.notifyOnBaseline) {
    await repos.seenOffers.markSeen(
      fresh.map((o) => o.id),
      now(),
    );
    report.baseline = true;
    logger.info(`baseline recorded: ${fresh.length} offers, no alerts sent`);
    return report;
  }

  const recipients = await repos.teachers.listActiveWithAlerts();
  const unreachable = new Set<number>();
  const processed: number[] = [];

  for (const offer of fresh) {
    const fullyServed = isOpen(offer, now()) ? await notifyMatching(offer) : true; // already closed: nothing to alert about
    if (fullyServed) processed.push(offer.id);
  }

  await repos.seenOffers.markSeen(processed, now());
  return report;

  async function notifyMatching(offer: Offer): Promise<boolean> {
    let fullyServed = true;
    for (const { teacher, alerts } of recipients) {
      if (unreachable.has(teacher.id)) continue;
      // One alert per (teacher, offer), even when several of their alerts match.
      const matched = alerts.filter((alert) => matches(offer, alert.criteria));
      if (matched.length === 0) continue;
      if (await repos.notifications.wasSent(teacher.id, offer.id)) continue;

      try {
        await notifier.notify(teacher, offer, matched);
      } catch (error) {
        if (error instanceof RecipientUnavailableError) {
          unreachable.add(teacher.id);
          await repos.teachers.setActive(teacher.id, false);
          report.deactivated++;
          logger.warn(`teacher ${teacher.id} unreachable, alerts paused`);
        } else {
          fullyServed = false;
          report.failed++;
          logger.warn(
            `failed to notify teacher ${teacher.id} of offer ${offer.id}: ${describe(error)}`,
          );
        }
        continue;
      }
      await repos.notifications.record(teacher.id, offer.id, now());
      report.sent++;
    }
    return fullyServed;
  }
}

const isOpen = (offer: Offer, at: Date): boolean => offer.closesAt.getTime() > at.getTime();

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

export interface SchedulerOptions {
  intervalMs: number;
  /** One cycle. Errors are caught and logged so a bad cycle never stops the scheduler. */
  cycle: () => Promise<unknown>;
  logger: Logger;
}

/**
 * Runs `cycle` immediately and then `intervalMs` after each run finishes, so cycles never
 * overlap. Returns a stop function that also waits for the running cycle.
 */
export function startScheduler({ intervalMs, cycle, logger }: SchedulerOptions): {
  stop: () => Promise<void>;
} {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const tick = (): void => {
    running = (async () => {
      try {
        await cycle();
      } catch (error) {
        logger.error(`cycle failed: ${describe(error)}`);
      }
      if (!stopped) timer = setTimeout(tick, intervalMs);
    })();
  };
  tick();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
