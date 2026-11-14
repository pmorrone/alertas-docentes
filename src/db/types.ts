import type { Criteria } from '../matcher/index.js';

export interface Teacher {
  /** Internal id. Prefer it over the Telegram chat id when logging. */
  id: number;
  telegramChatId: number;
  /** False while the teacher has paused alerts. */
  active: boolean;
  createdAt: Date;
}

export interface TeacherWithCriteria {
  teacher: Teacher;
  criteria: Criteria;
}

/*
 * The repositories are async on purpose: better-sqlite3 is synchronous, but keeping the
 * contract async lets us swap in Postgres without touching the callers.
 */

export interface TeacherRepository {
  /** Creates the teacher (active) or returns the existing one. Idempotent. */
  upsertByChatId(telegramChatId: number, now: Date): Promise<Teacher>;
  findByChatId(telegramChatId: number): Promise<Teacher | undefined>;
  setActive(teacherId: number, active: boolean): Promise<void>;
  /** Deletes the teacher and, with it, their criteria and notification history. */
  delete(teacherId: number): Promise<void>;
  /** Active teachers that have saved criteria. */
  listActiveWithCriteria(): Promise<TeacherWithCriteria[]>;
}

export interface CriteriaRepository {
  save(teacherId: number, criteria: Criteria, now: Date): Promise<void>;
  find(teacherId: number): Promise<Criteria | undefined>;
}

/** Offers (by `iddetalle`) the collector has already processed. */
export interface SeenOfferRepository {
  /** The subset of `offerIds` that were seen before. */
  findSeenIds(offerIds: readonly number[]): Promise<Set<number>>;
  markSeen(offerIds: readonly number[], now: Date): Promise<void>;
  count(): Promise<number>;
}

/** Which (teacher, offer) alerts were already sent. */
export interface NotificationRepository {
  wasSent(teacherId: number, offerId: number): Promise<boolean>;
  /** Idempotent: recording the same pair twice is a no-op. */
  record(teacherId: number, offerId: number, now: Date): Promise<void>;
}

export interface Repositories {
  teachers: TeacherRepository;
  criteria: CriteriaRepository;
  seenOffers: SeenOfferRepository;
  notifications: NotificationRepository;
}
