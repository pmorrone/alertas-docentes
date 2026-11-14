import { criteriaSchema, type Criteria } from '../matcher/index.js';
import type { Db } from './database.js';
import {
  AlertLimitError,
  type Alert,
  type AlertRepository,
  type NotificationRepository,
  type Repositories,
  type SeenOfferRepository,
  type Teacher,
  type TeacherRepository,
  type TeacherWithAlerts,
} from './types.js';

interface TeacherRow {
  id: number;
  telegram_chat_id: number;
  active: number;
  created_at: string;
}

const toTeacher = (row: TeacherRow): Teacher => ({
  id: row.id,
  telegramChatId: row.telegram_chat_id,
  active: row.active === 1,
  createdAt: new Date(row.created_at),
});

/** SQLite caps bound parameters per statement; stay well under any version's limit. */
const CHUNK_SIZE = 500;

function chunks<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK_SIZE) result.push(items.slice(i, i + CHUNK_SIZE));
  return result;
}

class SqliteTeacherRepository implements TeacherRepository {
  constructor(private readonly db: Db) {}

  async upsertByChatId(telegramChatId: number, now: Date): Promise<Teacher> {
    this.db
      .prepare('INSERT OR IGNORE INTO teachers (telegram_chat_id, created_at) VALUES (?, ?)')
      .run(telegramChatId, now.toISOString());
    const row = this.db
      .prepare('SELECT * FROM teachers WHERE telegram_chat_id = ?')
      .get(telegramChatId) as TeacherRow;
    return toTeacher(row);
  }

  async findByChatId(telegramChatId: number): Promise<Teacher | undefined> {
    const row = this.db
      .prepare('SELECT * FROM teachers WHERE telegram_chat_id = ?')
      .get(telegramChatId) as TeacherRow | undefined;
    return row && toTeacher(row);
  }

  async setActive(teacherId: number, active: boolean): Promise<void> {
    this.db.prepare('UPDATE teachers SET active = ? WHERE id = ?').run(active ? 1 : 0, teacherId);
  }

  async delete(teacherId: number): Promise<void> {
    this.db.prepare('DELETE FROM teachers WHERE id = ?').run(teacherId);
  }

  async listActiveWithAlerts(): Promise<TeacherWithAlerts[]> {
    const rows = this.db
      .prepare(
        `SELECT t.id AS t_id, t.telegram_chat_id, t.active AS t_active, t.created_at AS t_created,
                a.id, a.teacher_id, a.data, a.label, a.active, a.created_at
           FROM teachers t JOIN alerts a ON a.teacher_id = t.id
          WHERE t.active = 1 AND a.active = 1
          ORDER BY t.id, a.id`,
      )
      .all() as (AlertRow & {
      t_id: number;
      telegram_chat_id: number;
      t_active: number;
      t_created: string;
    })[];

    const byTeacher = new Map<number, TeacherWithAlerts>();
    for (const row of rows) {
      let entry = byTeacher.get(row.t_id);
      if (!entry) {
        const teacher = toTeacher({
          id: row.t_id,
          telegram_chat_id: row.telegram_chat_id,
          active: row.t_active,
          created_at: row.t_created,
        });
        entry = { teacher, alerts: [] };
        byTeacher.set(row.t_id, entry);
      }
      entry.alerts.push(toAlert(row));
    }
    return [...byTeacher.values()];
  }
}

interface AlertRow {
  id: number;
  teacher_id: number;
  data: string;
  label: string;
  active: number;
  created_at: string;
}

const toAlert = (row: AlertRow): Alert => ({
  id: row.id,
  teacherId: row.teacher_id,
  criteria: criteriaSchema.parse(JSON.parse(row.data)),
  label: row.label,
  active: row.active === 1,
  createdAt: new Date(row.created_at),
});

class SqliteAlertRepository implements AlertRepository {
  constructor(private readonly db: Db) {}

  async create(
    teacherId: number,
    criteria: Criteria,
    now: Date,
    maxAlerts: number,
    label = '',
  ): Promise<Alert> {
    // Count and insert in one transaction so the limit cannot be exceeded.
    const id = this.db.transaction((): number => {
      const { n } = this.db
        .prepare('SELECT COUNT(*) AS n FROM alerts WHERE teacher_id = ?')
        .get(teacherId) as { n: number };
      if (n >= maxAlerts) throw new AlertLimitError(maxAlerts);
      const result = this.db
        .prepare('INSERT INTO alerts (teacher_id, data, label, created_at) VALUES (?, ?, ?, ?)')
        .run(teacherId, JSON.stringify(criteria), label, now.toISOString());
      return Number(result.lastInsertRowid);
    })();
    return (await this.find(id)) as Alert;
  }

  async listByTeacher(teacherId: number): Promise<Alert[]> {
    const rows = this.db
      .prepare('SELECT * FROM alerts WHERE teacher_id = ? ORDER BY id')
      .all(teacherId) as AlertRow[];
    return rows.map(toAlert);
  }

  async find(alertId: number): Promise<Alert | undefined> {
    const row = this.db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId) as
      AlertRow | undefined;
    return row && toAlert(row);
  }

  async updateCriteria(alertId: number, criteria: Criteria): Promise<void> {
    this.db
      .prepare('UPDATE alerts SET data = ? WHERE id = ?')
      .run(JSON.stringify(criteria), alertId);
  }

  async setActive(alertId: number, active: boolean): Promise<void> {
    this.db.prepare('UPDATE alerts SET active = ? WHERE id = ?').run(active ? 1 : 0, alertId);
  }

  async delete(alertId: number): Promise<void> {
    this.db.prepare('DELETE FROM alerts WHERE id = ?').run(alertId);
  }
}

class SqliteSeenOfferRepository implements SeenOfferRepository {
  constructor(private readonly db: Db) {}

  async findSeenIds(offerIds: readonly number[]): Promise<Set<number>> {
    const seen = new Set<number>();
    for (const chunk of chunks(offerIds)) {
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.db
        .prepare(`SELECT offer_id FROM seen_offers WHERE offer_id IN (${placeholders})`)
        .all(...chunk) as { offer_id: number }[];
      for (const row of rows) seen.add(row.offer_id);
    }
    return seen;
  }

  async markSeen(offerIds: readonly number[], now: Date): Promise<void> {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO seen_offers (offer_id, first_seen_at) VALUES (?, ?)',
    );
    const iso = now.toISOString();
    this.db.transaction(() => {
      for (const id of offerIds) insert.run(id, iso);
    })();
  }

  async count(): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM seen_offers').get() as { n: number };
    return row.n;
  }
}

class SqliteNotificationRepository implements NotificationRepository {
  constructor(private readonly db: Db) {}

  async wasSent(teacherId: number, offerId: number): Promise<boolean> {
    const row = this.db
      .prepare('SELECT 1 FROM sent_notifications WHERE teacher_id = ? AND offer_id = ?')
      .get(teacherId, offerId);
    return row !== undefined;
  }

  async record(teacherId: number, offerId: number, now: Date): Promise<void> {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO sent_notifications (teacher_id, offer_id, sent_at) VALUES (?, ?, ?)',
      )
      .run(teacherId, offerId, now.toISOString());
  }
}

export function createSqliteRepositories(db: Db): Repositories {
  return {
    teachers: new SqliteTeacherRepository(db),
    alerts: new SqliteAlertRepository(db),
    seenOffers: new SqliteSeenOfferRepository(db),
    notifications: new SqliteNotificationRepository(db),
  };
}
