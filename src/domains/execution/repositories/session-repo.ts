import type {
  DocumentSnapshot,
  Firestore,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';

import {
  DEFAULT_BOT_TIMEZONE,
  getTodayDateKey,
  getZonedDayUtcRange,
} from '../../../shared/calendar-day';
import { getFirestoreDb } from '../../../infra/firebase/firestore';
import type { ExecutionSession } from '../types/execution.types';
import { EXECUTION_SESSIONS } from './execution-collections';

const MAX_QUERY_LIMIT = 100;
const DEFAULT_RECENT_LIMIT = 25;
const DEFAULT_DAY_LIMIT = 50;

export type StoredExecutionSession = ExecutionSession & { id: string };

/** Filter completed sessions whose `endedAt` falls in `[startMs, endMsExclusive)`. */
export type ExecutionSessionEndedAtRange = {
  startMs: number;
  endMsExclusive: number;
};

function clampLimit(n: number | undefined, fallback: number): number {
  const raw = n === undefined || !Number.isFinite(n) ? fallback : Math.floor(n);
  return Math.min(Math.max(raw, 1), MAX_QUERY_LIMIT);
}

function toFirestorePayload(session: ExecutionSession): Record<string, unknown> {
  return {
    discordUserId: session.discordUserId,
    guildId: session.guildId,
    channelId: session.channelId,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationMs: session.durationMs,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function mapSnapshotToSession(
  snap: DocumentSnapshot | QueryDocumentSnapshot,
): StoredExecutionSession | null {
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;

  const discordUserId = data.discordUserId;
  const guildId = data.guildId;
  const channelId = data.channelId;
  const startedAt = data.startedAt;
  const endedAt = data.endedAt;
  const durationMs = data.durationMs;
  const createdAt = data.createdAt;
  const updatedAt = data.updatedAt;

  if (
    typeof discordUserId !== 'string' ||
    typeof guildId !== 'string' ||
    typeof channelId !== 'string' ||
    typeof startedAt !== 'number' ||
    typeof endedAt !== 'number' ||
    typeof durationMs !== 'number' ||
    typeof createdAt !== 'number' ||
    typeof updatedAt !== 'number'
  ) {
    return null;
  }

  if (!snap.id) return null;

  return {
    id: snap.id,
    discordUserId,
    guildId,
    channelId,
    startedAt,
    endedAt,
    durationMs,
    createdAt,
    updatedAt,
  };
}

/**
 * Completed execution sessions (auto-generated document IDs).
 * Queries use `discordUserId` + `endedAt` only — keep indexes narrow and cheap.
 */
export class SessionRepo {
  constructor(private readonly db: Firestore = getFirestoreDb()) {}

  private collection() {
    return this.db.collection(EXECUTION_SESSIONS);
  }

  /** Persists a completed session; returns the new document ID. */
  async createSession(session: ExecutionSession): Promise<string> {
    const ref = await this.collection().add(toFirestorePayload(session));
    return ref.id;
  }

  /**
   * Most recently completed sessions for a user (by `endedAt` descending).
   */
  async getRecentSessionsByUser(
    discordUserId: string,
    limit?: number,
  ): Promise<StoredExecutionSession[]> {
    if (!discordUserId) return [];
    const lim = clampLimit(limit, DEFAULT_RECENT_LIMIT);
    const q = await this.collection()
      .where('discordUserId', '==', discordUserId)
      .orderBy('endedAt', 'desc')
      .limit(lim)
      .get();

    const out: StoredExecutionSession[] = [];
    for (const doc of q.docs) {
      const row = mapSnapshotToSession(doc);
      if (row) out.push(row);
    }
    return out;
  }

  /**
   * Sessions ended on a calendar day (`dateKey` + `timeZone`) or in an explicit `endedAt` range.
   */
  async getSessionsForUserOnDate(
    discordUserId: string,
    filter: { dateKey: string; timeZone: string } | ExecutionSessionEndedAtRange,
    limit?: number,
  ): Promise<StoredExecutionSession[]> {
    if (!discordUserId) return [];
    const lim = clampLimit(limit, DEFAULT_DAY_LIMIT);

    const range: ExecutionSessionEndedAtRange =
      'dateKey' in filter
        ? getZonedDayUtcRange(filter.dateKey, filter.timeZone)
        : filter;

    return this.querySessionsEndedInRange(discordUserId, range, lim);
  }

  /**
   * Sessions whose `endedAt` falls on the current calendar day in `timeZone`
   * (defaults to {@link DEFAULT_BOT_TIMEZONE}, matching `scripts/lib/missionBank.js`).
   */
  async getTodaySessionsByUser(
    discordUserId: string,
    timeZone: string = DEFAULT_BOT_TIMEZONE,
    limit?: number,
  ): Promise<StoredExecutionSession[]> {
    const dateKey = getTodayDateKey(timeZone);
    return this.getSessionsForUserOnDate(discordUserId, { dateKey, timeZone }, limit);
  }

  private async querySessionsEndedInRange(
    discordUserId: string,
    range: ExecutionSessionEndedAtRange,
    limit: number,
  ): Promise<StoredExecutionSession[]> {
    const q = await this.collection()
      .where('discordUserId', '==', discordUserId)
      .where('endedAt', '>=', range.startMs)
      .where('endedAt', '<', range.endMsExclusive)
      .orderBy('endedAt', 'desc')
      .limit(limit)
      .get();

    const out: StoredExecutionSession[] = [];
    for (const doc of q.docs) {
      const row = mapSnapshotToSession(doc);
      if (row) out.push(row);
    }
    return out;
  }
}
