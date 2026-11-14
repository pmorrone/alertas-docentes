import type { Criteria } from '../matcher/index.js';

export interface Teacher {
  /** Internal id. Prefer it over the Telegram chat id when logging. */
  id: number;
  telegramChatId: number;
  /** False while the teacher has paused alerts. */
  active: boolean;
  createdAt: Date;
}

/** One saved search. A teacher can have several (up to the configured maximum). */
export interface Alert {
  id: number;
  teacherId: number;
  criteria: Criteria;
  /** Readable name, e.g. "Historia · Pilar · Tarde". Empty for alerts created before labels existed. */
  label: string;
  /** False while this single alert is paused (independent of the teacher's global pause). */
  active: boolean;
  createdAt: Date;
}

export interface TeacherWithAlerts {
  teacher: Teacher;
  /** Only the active alerts; never empty. */
  alerts: Alert[];
}

/** Thrown by `AlertRepository.create` when the teacher already has the maximum. */
export class AlertLimitError extends Error {
  constructor(readonly maxAlerts: number) {
    super(`alert limit reached (${maxAlerts})`);
    this.name = 'AlertLimitError';
  }
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
  /** Deletes the teacher and, with it, their alerts and notification history. */
  delete(teacherId: number): Promise<void>;
  /** Active teachers that have at least one active alert, with those alerts. */
  listActiveWithAlerts(): Promise<TeacherWithAlerts[]>;
  /** How many teachers are registered (paused ones included). */
  count(): Promise<number>;
}

export interface AlertRepository {
  /**
   * Adds an alert (active). Paused alerts count toward the limit.
   * @throws AlertLimitError when the teacher already has `maxAlerts`.
   */
  create(
    teacherId: number,
    criteria: Criteria,
    now: Date,
    maxAlerts: number,
    label?: string,
  ): Promise<Alert>;
  /** All of the teacher's alerts, paused or not, oldest first. */
  listByTeacher(teacherId: number): Promise<Alert[]>;
  find(alertId: number): Promise<Alert | undefined>;
  updateCriteria(alertId: number, criteria: Criteria): Promise<void>;
  setActive(alertId: number, active: boolean): Promise<void>;
  delete(alertId: number): Promise<void>;
  /** Total alerts of all teachers. */
  count(): Promise<number>;
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

/** Single-use invitation codes for the pilot. */
export interface InviteRepository {
  /** Stores a new, unused code. Codes are unique. */
  create(code: string, now: Date): Promise<void>;
  /**
   * Marks an unused code as used by `chatId`. Atomic: of two simultaneous attempts only one
   * wins. Returns false for unknown or already used codes.
   */
  redeem(code: string, chatId: number, now: Date): Promise<boolean>;
  stats(): Promise<{ unused: number; used: number }>;
}

/** People who asked for access when the pilot had no room or they had no code. */
export interface WaitlistRepository {
  /** Returns true when the chat was added now, false if it was already waiting. */
  add(chatId: number, now: Date): Promise<boolean>;
  remove(chatId: number): Promise<void>;
  count(): Promise<number>;
}

export interface Repositories {
  teachers: TeacherRepository;
  alerts: AlertRepository;
  seenOffers: SeenOfferRepository;
  notifications: NotificationRepository;
  invites: InviteRepository;
  waitlist: WaitlistRepository;
}
