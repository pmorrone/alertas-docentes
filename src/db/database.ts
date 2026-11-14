import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/** Ordered, append-only list of migrations. `PRAGMA user_version` tracks how many ran. */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE teachers (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_chat_id INTEGER NOT NULL UNIQUE,
    active           INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL
  );

  CREATE TABLE criteria (
    teacher_id INTEGER PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
    data       TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE seen_offers (
    offer_id      INTEGER PRIMARY KEY,
    first_seen_at TEXT NOT NULL
  );

  CREATE TABLE sent_notifications (
    teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    offer_id   INTEGER NOT NULL,
    sent_at    TEXT NOT NULL,
    PRIMARY KEY (teacher_id, offer_id)
  );
  `,
];

export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version] as string);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}

/** Opens (creating it if needed) the SQLite database and applies pending migrations. */
export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
