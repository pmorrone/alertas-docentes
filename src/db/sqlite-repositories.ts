import { criteriaSchema, type Criteria } from '../matcher/index.js';
import type { Db } from './database.js';
import type {
  CriteriaRepository,
  NotificationRepository,
  Repositories,
  SeenOfferRepository,
  Teacher,
  TeacherRepository,
  TeacherWithCriteria,
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

  async listActiveWithCriteria(): Promise<TeacherWithCriteria[]> {
    const rows = this.db
      .prepare(
        `SELECT t.*, c.data AS criteria_data
           FROM teachers t JOIN criteria c ON c.teacher_id = t.id
          WHERE t.active = 1
          ORDER BY t.id`,
      )
      .all() as (TeacherRow & { criteria_data: string })[];
    return rows.map((row) => ({
      teacher: toTeacher(row),
      criteria: criteriaSchema.parse(JSON.parse(row.criteria_data)),
    }));
  }
}

class SqliteCriteriaRepository implements CriteriaRepository {
  constructor(private readonly db: Db) {}

  async save(teacherId: number, criteria: Criteria, now: Date): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO criteria (teacher_id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(teacher_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(teacherId, JSON.stringify(criteria), now.toISOString());
  }

  async find(teacherId: number): Promise<Criteria | undefined> {
    const row = this.db.prepare('SELECT data FROM criteria WHERE teacher_id = ?').get(teacherId) as
      { data: string } | undefined;
    return row && criteriaSchema.parse(JSON.parse(row.data));
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
    criteria: new SqliteCriteriaRepository(db),
    seenOffers: new SqliteSeenOfferRepository(db),
    notifications: new SqliteNotificationRepository(db),
  };
}
