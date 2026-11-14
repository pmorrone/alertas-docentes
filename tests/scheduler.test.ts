import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectResult, Offer } from '../src/collector/index.js';
import {
  createSqliteRepositories,
  openDatabase,
  type Db,
  type Repositories,
} from '../src/db/index.js';
import { silentLogger } from '../src/logger.js';
import { createCriteria, type Criteria } from '../src/matcher/index.js';
import { RecipientUnavailableError, type Notifier } from '../src/notifier/types.js';
import { runCycle, startScheduler, type CycleDeps } from '../src/scheduler.js';
import { makeOffer } from './matcher/helpers.js';

const NOW = new Date('2026-11-13T12:00:00Z');
const OPEN = { finoferta: '2026-11-20T12:00:00Z' };

describe('runCycle', () => {
  let db: Db;
  let repos: Repositories;
  let published: Offer[];
  let notify: ReturnType<typeof vi.fn<Notifier['notify']>>;

  const deps = (extra: Partial<CycleDeps> = {}): CycleDeps => ({
    collector: {
      fetchPublishedOffers: async (): Promise<CollectResult> => ({
        offers: published,
        numFound: published.length,
        skipped: 0,
      }),
    },
    repos,
    notifier: { notify },
    logger: silentLogger,
    now: () => NOW,
    ...extra,
  });

  async function addTeacher(chatId: number, criteria: Criteria = createCriteria({})) {
    const teacher = await repos.teachers.upsertByChatId(chatId, NOW);
    await repos.alerts.create(teacher.id, criteria, NOW, 3);
    return teacher;
  }

  /** Runs the first cycle, which only records the baseline, so later cycles see "new" offers. */
  async function establishBaseline(offers: Offer[] = [makeOffer({ iddetalle: 1, ...OPEN })]) {
    published = offers;
    const report = await runCycle(deps());
    expect(report.baseline).toBe(true);
  }

  beforeEach(() => {
    db = openDatabase(':memory:');
    repos = createSqliteRepositories(db);
    published = [];
    notify = vi.fn<Notifier['notify']>().mockResolvedValue();
  });
  afterEach(() => db.close());

  it('records the first cycle as a silent baseline', async () => {
    await addTeacher(1);
    published = [makeOffer({ iddetalle: 1, ...OPEN }), makeOffer({ iddetalle: 2, ...OPEN })];

    const report = await runCycle(deps());

    expect(report).toMatchObject({ collected: 2, newOffers: 2, baseline: true, sent: 0 });
    expect(notify).not.toHaveBeenCalled();
    expect(await repos.seenOffers.count()).toBe(2);
  });

  it('can notify on the baseline when asked to', async () => {
    await addTeacher(1);
    published = [makeOffer({ iddetalle: 1, ...OPEN })];

    const report = await runCycle(deps({ notifyOnBaseline: true }));

    expect(report).toMatchObject({ baseline: false, sent: 1 });
  });

  it('notifies matching teachers about new offers, once', async () => {
    const pilar = await addTeacher(1, createCriteria({ districts: ['Pilar'] }));
    await addTeacher(2, createCriteria({ districts: ['Tandil'] }));
    await establishBaseline();
    published = [...published, makeOffer({ iddetalle: 2, ...OPEN })]; // PILAR

    const first = await runCycle(deps());
    const second = await runCycle(deps());

    expect(first).toMatchObject({ newOffers: 1, sent: 1, failed: 0 });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0].id).toBe(pilar.id);
    expect(notify.mock.calls[0]?.[1].id).toBe(2);
    expect(second).toMatchObject({ newOffers: 0, sent: 0 });
    expect(await repos.notifications.wasSent(pilar.id, 2)).toBe(true);
  });

  it('does not alert paused teachers or teachers without alerts', async () => {
    const paused = await addTeacher(1);
    await repos.teachers.setActive(paused.id, false);
    await repos.teachers.upsertByChatId(2, NOW); // no alerts
    await establishBaseline();
    published = [...published, makeOffer({ iddetalle: 2, ...OPEN })];

    await runCycle(deps());

    expect(notify).not.toHaveBeenCalled();
  });

  it('sends a single alert when several alerts of one teacher match, listing them', async () => {
    const teacher = await repos.teachers.upsertByChatId(1, NOW);
    const district = await repos.alerts.create(
      teacher.id,
      createCriteria({ districts: ['Pilar'] }),
      NOW,
      3,
    );
    const area = await repos.alerts.create(teacher.id, createCriteria({ areas: ['mdp'] }), NOW, 3);
    await repos.alerts.create(teacher.id, createCriteria({ districts: ['Tandil'] }), NOW, 3);
    await establishBaseline();
    published = [...published, makeOffer({ iddetalle: 2, ...OPEN })]; // PILAR, MDP

    const report = await runCycle(deps());

    expect(report.sent).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    const matched = notify.mock.calls[0]?.[2];
    expect(matched?.map((a) => a.id)).toEqual([district.id, area.id]);
  });

  it('ignores paused alerts and alerts of other offers', async () => {
    const teacher = await repos.teachers.upsertByChatId(1, NOW);
    const pausedAlert = await repos.alerts.create(
      teacher.id,
      createCriteria({ districts: ['Pilar'] }),
      NOW,
      3,
    );
    const live = await repos.alerts.create(
      teacher.id,
      createCriteria({ districts: ['Pilar'], shifts: ['T'] }),
      NOW,
      3,
    );
    await repos.alerts.setActive(pausedAlert.id, false);
    await establishBaseline();
    published = [...published, makeOffer({ iddetalle: 2, ...OPEN })];

    await runCycle(deps());

    expect(notify.mock.calls[0]?.[2].map((a) => a.id)).toEqual([live.id]);
  });

  it('alerts a teacher about different offers through different alerts', async () => {
    const teacher = await repos.teachers.upsertByChatId(1, NOW);
    await repos.alerts.create(teacher.id, createCriteria({ districts: ['Pilar'] }), NOW, 3);
    await repos.alerts.create(teacher.id, createCriteria({ districts: ['Tandil'] }), NOW, 3);
    await establishBaseline();
    published = [
      ...published,
      makeOffer({ iddetalle: 2, ...OPEN }),
      makeOffer({ iddetalle: 3, descdistrito: 'TANDIL', ...OPEN }),
    ];

    const report = await runCycle(deps());

    expect(report.sent).toBe(2);
    expect(notify.mock.calls.map(([, o, alerts]) => [o.id, alerts.length])).toEqual([
      [2, 1],
      [3, 1],
    ]);
  });

  it('does not alert about offers that are not Publicada', async () => {
    await addTeacher(1);
    await establishBaseline();
    published = [...published, makeOffer({ iddetalle: 2, estado: 'Designada', ...OPEN })];

    await runCycle(deps());

    expect(notify).not.toHaveBeenCalled();
  });

  it('skips offers that already closed but still marks them as seen', async () => {
    await addTeacher(1);
    await establishBaseline();
    published = [...published, makeOffer({ iddetalle: 2, finoferta: '2026-11-13T11:00:00Z' })];

    const report = await runCycle(deps());

    expect(notify).not.toHaveBeenCalled();
    expect(report.newOffers).toBe(1);
    expect(await repos.seenOffers.findSeenIds([2])).toEqual(new Set([2]));
  });

  it('retries a transient failure next cycle without duplicating alerts', async () => {
    const a = await addTeacher(1);
    const b = await addTeacher(2);
    await establishBaseline();
    published = [...published, makeOffer({ iddetalle: 2, ...OPEN })];
    notify.mockImplementation(async (teacher) => {
      if (teacher.id === b.id) throw new Error('telegram timeout');
    });

    const first = await runCycle(deps());
    expect(first).toMatchObject({ sent: 1, failed: 1 });
    expect(await repos.seenOffers.findSeenIds([2])).toEqual(new Set()); // will be retried

    notify.mockClear().mockResolvedValue();
    const second = await runCycle(deps());

    expect(second).toMatchObject({ newOffers: 1, sent: 1, failed: 0 });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0].id).toBe(b.id); // teacher a is not alerted again
    expect(await repos.notifications.wasSent(a.id, 2)).toBe(true);
    expect(await repos.seenOffers.findSeenIds([2])).toEqual(new Set([2]));
  });

  it('pauses a teacher that cannot be reached and does not retry forever', async () => {
    const blocked = await addTeacher(1);
    const ok = await addTeacher(2);
    await establishBaseline();
    published = [
      ...published,
      makeOffer({ iddetalle: 2, ...OPEN }),
      makeOffer({ iddetalle: 3, ...OPEN }),
    ];
    notify.mockImplementation(async (teacher) => {
      if (teacher.id === blocked.id) throw new RecipientUnavailableError();
    });

    const report = await runCycle(deps());

    expect(report).toMatchObject({ sent: 2, failed: 0, deactivated: 1 });
    // The blocked teacher was only attempted once (then skipped for offer 3).
    expect(notify.mock.calls.filter(([t]) => t.id === blocked.id)).toHaveLength(1);
    expect((await repos.teachers.findByChatId(1))?.active).toBe(false);
    expect((await repos.teachers.findByChatId(2))?.active).toBe(true);
    expect(await repos.notifications.wasSent(blocked.id, 2)).toBe(false);
    expect(await repos.notifications.wasSent(ok.id, 3)).toBe(true);
    expect(await repos.seenOffers.findSeenIds([2, 3])).toEqual(new Set([2, 3]));
  });

  it('propagates collector errors so the scheduler can log them', async () => {
    const failing = deps({
      collector: {
        fetchPublishedOffers: async () => {
          throw new Error('api down');
        },
      },
    });

    await expect(runCycle(failing)).rejects.toThrow('api down');
  });
});

describe('startScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs immediately and then every interval', async () => {
    const cycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = startScheduler({ intervalMs: 1000, cycle, logger: silentLogger });

    expect(cycle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(cycle).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(cycle).toHaveBeenCalledTimes(4);

    await scheduler.stop();
  });

  it('never overlaps cycles: the interval counts from the end of the previous one', async () => {
    let finish!: () => void;
    const cycle = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const scheduler = startScheduler({ intervalMs: 1000, cycle, logger: silentLogger });

    await vi.advanceTimersByTimeAsync(5000); // cycle still running
    expect(cycle).toHaveBeenCalledTimes(1);

    finish();
    await vi.advanceTimersByTimeAsync(999);
    expect(cycle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(cycle).toHaveBeenCalledTimes(2);

    finish();
    await scheduler.stop();
  });

  it('keeps going after a failed cycle and logs it', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const cycle = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const scheduler = startScheduler({ intervalMs: 1000, cycle, logger });

    await vi.advanceTimersByTimeAsync(1000);

    expect(cycle).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('boom'));
    await scheduler.stop();
  });

  it('stop prevents further cycles', async () => {
    const cycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = startScheduler({ intervalMs: 1000, cycle, logger: silentLogger });

    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(cycle).toHaveBeenCalledTimes(1);
  });
});
