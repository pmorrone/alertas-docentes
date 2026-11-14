import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AlertLimitError,
  createSqliteRepositories,
  migrate,
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

    it('lists only active teachers with their active alerts', async () => {
      const t1 = await repos.teachers.upsertByChatId(1, NOW);
      const pausedTeacher = await repos.teachers.upsertByChatId(2, NOW);
      const onlyPausedAlerts = await repos.teachers.upsertByChatId(3, NOW);
      await repos.teachers.upsertByChatId(4, NOW); // no alerts
      const history = createCriteria({ areas: ['historia'], districts: ['Tandil'] });
      const geography = createCriteria({ areas: ['geografia'], districts: ['Ayacucho'] });
      const a1 = await repos.alerts.create(t1.id, history, NOW, 3);
      const a2 = await repos.alerts.create(t1.id, geography, NOW, 3);
      const pausedAlert = await repos.alerts.create(t1.id, createCriteria({}), NOW, 3);
      await repos.alerts.setActive(pausedAlert.id, false);
      await repos.alerts.create(pausedTeacher.id, history, NOW, 3);
      await repos.teachers.setActive(pausedTeacher.id, false);
      const p3 = await repos.alerts.create(onlyPausedAlerts.id, history, NOW, 3);
      await repos.alerts.setActive(p3.id, false);

      const list = await repos.teachers.listActiveWithAlerts();

      expect(list).toEqual([{ teacher: t1, alerts: [a1, a2] }]);
    });

    it('delete removes the teacher, their alerts and their notification history', async () => {
      const t = await repos.teachers.upsertByChatId(1, NOW);
      const other = await repos.teachers.upsertByChatId(2, NOW);
      const alert = await repos.alerts.create(t.id, createCriteria({}), NOW, 3);
      const otherAlert = await repos.alerts.create(other.id, createCriteria({}), NOW, 3);
      await repos.notifications.record(t.id, 10, NOW);
      await repos.notifications.record(other.id, 10, NOW);

      await repos.teachers.delete(t.id);

      expect(await repos.teachers.findByChatId(1)).toBeUndefined();
      expect(await repos.alerts.find(alert.id)).toBeUndefined();
      expect(await repos.notifications.wasSent(t.id, 10)).toBe(false);
      expect(await repos.alerts.find(otherAlert.id)).toBeDefined();
      expect(await repos.notifications.wasSent(other.id, 10)).toBe(true);
    });
  });

  describe('alerts', () => {
    it('creates active alerts and lists them oldest first', async () => {
      const t = await repos.teachers.upsertByChatId(1, NOW);
      const c1 = createCriteria({ districts: ['Pilar'], areas: ['mdp'], onlySubstitutes: true });
      const c2 = createCriteria({ levels: ['secundaria'], shifts: ['T', 'N'] });

      const a1 = await repos.alerts.create(t.id, c1, NOW, 3);
      const a2 = await repos.alerts.create(t.id, c2, NOW, 3);

      expect(a1).toEqual({
        id: a1.id,
        teacherId: t.id,
        criteria: c1,
        active: true,
        createdAt: NOW,
      });
      expect(await repos.alerts.listByTeacher(t.id)).toEqual([a1, a2]);
      expect(await repos.alerts.find(a2.id)).toEqual(a2);
    });

    it('enforces the per-teacher limit, counting paused alerts, per teacher', async () => {
      const t = await repos.teachers.upsertByChatId(1, NOW);
      const other = await repos.teachers.upsertByChatId(2, NOW);
      const first = await repos.alerts.create(t.id, createCriteria({}), NOW, 2);
      await repos.alerts.create(t.id, createCriteria({}), NOW, 2);
      await repos.alerts.setActive(first.id, false);

      await expect(repos.alerts.create(t.id, createCriteria({}), NOW, 2)).rejects.toBeInstanceOf(
        AlertLimitError,
      );
      expect(await repos.alerts.listByTeacher(t.id)).toHaveLength(2);
      await expect(
        repos.alerts.create(other.id, createCriteria({}), NOW, 2),
      ).resolves.toBeDefined();

      await repos.alerts.delete(first.id);
      await expect(repos.alerts.create(t.id, createCriteria({}), NOW, 2)).resolves.toBeDefined();
    });

    it('updates criteria, pauses and deletes a single alert', async () => {
      const t = await repos.teachers.upsertByChatId(1, NOW);
      const keep = await repos.alerts.create(t.id, createCriteria({ areas: ['historia'] }), NOW, 3);
      const edit = await repos.alerts.create(
        t.id,
        createCriteria({ areas: ['geografia'] }),
        NOW,
        3,
      );

      const updated = createCriteria({ areas: ['geografia'], shifts: ['T'] });
      await repos.alerts.updateCriteria(edit.id, updated);
      await repos.alerts.setActive(edit.id, false);

      expect(await repos.alerts.find(edit.id)).toMatchObject({ criteria: updated, active: false });
      expect((await repos.alerts.find(keep.id))?.active).toBe(true);

      await repos.alerts.delete(edit.id);
      expect(await repos.alerts.listByTeacher(t.id)).toEqual([keep]);
    });

    it('returns undefined for an unknown alert', async () => {
      expect(await repos.alerts.find(999)).toBeUndefined();
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
    expect(db2.pragma('user_version', { simple: true })).toBe(2);
    db2.close();
  });
});

describe('migrations', () => {
  it('turns the single-criteria rows of schema v1 into one alert per teacher', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db, 1);
    db.prepare(
      "INSERT INTO teachers (telegram_chat_id, created_at) VALUES (7, '2026-11-01T00:00:00Z')",
    ).run();
    const criteria = createCriteria({ districts: ['Tandil'], areas: ['historia'] });
    db.prepare(
      "INSERT INTO criteria (teacher_id, data, updated_at) VALUES (1, ?, '2026-11-02T00:00:00Z')",
    ).run(JSON.stringify(criteria));

    migrate(db);

    const repos = createSqliteRepositories(db);
    expect(await repos.alerts.listByTeacher(1)).toEqual([
      {
        id: 1,
        teacherId: 1,
        criteria,
        active: true,
        createdAt: new Date('2026-11-02T00:00:00Z'),
      },
    ]);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'criteria'").get(),
    ).toBeUndefined();
    db.close();
  });
});
