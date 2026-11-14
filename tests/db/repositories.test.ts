import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSqliteRepositories,
  openDatabase,
  type Db,
  type Repositories,
} from '../../src/db/index.js';
import { createCriteria } from '../../src/matcher/index.js';

const NOW = new Date('2026-11-13T12:00:00Z');

describe('sqlite repositories', () => {
  let db: Db;
  let repos: Repositories;

  beforeEach(() => {
    db = openDatabase(':memory:');
    repos = createSqliteRepositories(db);
  });
  afterEach(() => db.close());

  describe('teachers', () => {
    it('creates an active teacher and is idempotent per chat id', async () => {
      const a = await repos.teachers.upsertByChatId(5_000_000_001, NOW);
      const b = await repos.teachers.upsertByChatId(5_000_000_001, new Date('2027-01-01'));

      expect(a).toEqual({ id: a.id, telegramChatId: 5_000_000_001, active: true, createdAt: NOW });
      expect(b.id).toBe(a.id);
      expect(b.createdAt).toEqual(NOW);
    });

    it('finds teachers by chat id', async () => {
      expect(await repos.teachers.findByChatId(1)).toBeUndefined();
      const t = await repos.teachers.upsertByChatId(1, NOW);
      expect(await repos.teachers.findByChatId(1)).toEqual(t);
    });

    it('pauses and resumes', async () => {
      const t = await repos.teachers.upsertByChatId(1, NOW);
      await repos.teachers.setActive(t.id, false);
      expect((await repos.teachers.findByChatId(1))?.active).toBe(false);
      await repos.teachers.setActive(t.id, true);
      expect((await repos.teachers.findByChatId(1))?.active).toBe(true);
    });

    it('lists only active teachers that have criteria', async () => {
      const withCriteria = await repos.teachers.upsertByChatId(1, NOW);
      const paused = await repos.teachers.upsertByChatId(2, NOW);
      await repos.teachers.upsertByChatId(3, NOW); // no criteria
      const criteria = createCriteria({ districts: ['Tandil'], shifts: ['M'] });
      await repos.criteria.save(withCriteria.id, criteria, NOW);
      await repos.criteria.save(paused.id, criteria, NOW);
      await repos.teachers.setActive(paused.id, false);

      const list = await repos.teachers.listActiveWithCriteria();

      expect(list).toEqual([{ teacher: withCriteria, criteria }]);
    });

    it('delete removes the teacher, their criteria and their notification history', async () => {
      const t = await repos.teachers.upsertByChatId(1, NOW);
      const other = await repos.teachers.upsertByChatId(2, NOW);
      await repos.criteria.save(t.id, createCriteria({}), NOW);
      await repos.notifications.record(t.id, 10, NOW);
      await repos.notifications.record(other.id, 10, NOW);

      await repos.teachers.delete(t.id);

      expect(await repos.teachers.findByChatId(1)).toBeUndefined();
      expect(await repos.criteria.find(t.id)).toBeUndefined();
      expect(await repos.notifications.wasSent(t.id, 10)).toBe(false);
      expect(await repos.notifications.wasSent(other.id, 10)).toBe(true);
    });
  });

  describe('criteria', () => {
    it('round-trips and overwrites', async () => {
      const t = await repos.teachers.upsertByChatId(1, NOW);
      const first = createCriteria({ districts: ['Pilar'], areas: ['mdp'], onlySubstitutes: true });
      await repos.criteria.save(t.id, first, NOW);
      expect(await repos.criteria.find(t.id)).toEqual(first);

      const second = createCriteria({ levels: ['secundaria'], shifts: ['T', 'N'] });
      await repos.criteria.save(t.id, second, NOW);
      expect(await repos.criteria.find(t.id)).toEqual(second);
    });

    it('returns undefined when there are none', async () => {
      expect(await repos.criteria.find(999)).toBeUndefined();
    });
  });

  describe('seen offers', () => {
    it('reports which ids were seen and is idempotent', async () => {
      expect(await repos.seenOffers.count()).toBe(0);
      await repos.seenOffers.markSeen([1, 2, 3], NOW);
      await repos.seenOffers.markSeen([3, 4], NOW);

      expect(await repos.seenOffers.findSeenIds([2, 4, 5])).toEqual(new Set([2, 4]));
      expect(await repos.seenOffers.count()).toBe(4);
    });

    it('handles more ids than a single SQL statement can bind', async () => {
      const ids = Array.from({ length: 2600 }, (_, i) => i + 1);
      await repos.seenOffers.markSeen(ids, NOW);

      expect((await repos.seenOffers.findSeenIds(ids)).size).toBe(2600);
    });
  });

  describe('notifications', () => {
    it('records a (teacher, offer) pair once', async () => {
      const t = await repos.teachers.upsertByChatId(1, NOW);
      expect(await repos.notifications.wasSent(t.id, 7)).toBe(false);

      await repos.notifications.record(t.id, 7, NOW);
      await repos.notifications.record(t.id, 7, NOW);

      expect(await repos.notifications.wasSent(t.id, 7)).toBe(true);
      expect(await repos.notifications.wasSent(t.id, 8)).toBe(false);
    });
  });
});

describe('openDatabase', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'alertas-db-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates missing folders, persists data and re-runs migrations safely', async () => {
    const path = join(dir, 'nested', 'alertas.sqlite');

    const db1 = openDatabase(path);
    await createSqliteRepositories(db1).teachers.upsertByChatId(42, NOW);
    db1.close();

    const db2 = openDatabase(path);
    const found = await createSqliteRepositories(db2).teachers.findByChatId(42);
    expect(found?.telegramChatId).toBe(42);
    expect(db2.pragma('user_version', { simple: true })).toBe(1);
    db2.close();
  });
});
