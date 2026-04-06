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
import type { ClosedLoop } from '../types/execution.types';
import { EXECUTION_CLOSED_LOOPS } from './execution-collections';

const MAX_RANGE_QUERY = 100;

export type TimestampRange = { startMs: number; endMsExclusive: number };

function toFirestorePayload(loop: ClosedLoop): Record<string, unknown> {
  const base: Record<string, unknown> = {
    loopId: loop.loopId,
    discordUserId: loop.discordUserId,
    guildId: loop.guildId,
    channelId: loop.channelId,
    commitmentText: loop.commitmentText,
    openedAt: loop.openedAt,
    closedAt: loop.closedAt,
    openDurationMs: loop.openDurationMs,
    proofType: loop.proofType,
    reflectionStatus: loop.reflectionStatus,
    createdAt: loop.createdAt,
    updatedAt: loop.updatedAt,
    schemaVersion: 1,
  };
  if (loop.proofText !== undefined) base.proofText = loop.proofText;
  if (loop.proofAttachmentUrls !== undefined && loop.proofAttachmentUrls.length > 0) {
    base.proofAttachmentUrls = loop.proofAttachmentUrls;
  }
  if (loop.proofMessageId !== undefined) base.proofMessageId = loop.proofMessageId;
  if (loop.reflectionNotes !== undefined) base.reflectionNotes = loop.reflectionNotes;
  return base;
}

function mapSnapshotToClosedLoop(
  snap: DocumentSnapshot | QueryDocumentSnapshot,
): (ClosedLoop & { id: string }) | null {
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;

  const loopId = data.loopId;
  const discordUserId = data.discordUserId;
  const guildId = data.guildId;
  const channelId = data.channelId;
  const commitmentText = data.commitmentText;
  const openedAt = data.openedAt;
  const closedAt = data.closedAt;
  const openDurationMs = data.openDurationMs;
  const proofType = data.proofType;
  const reflectionStatus = data.reflectionStatus;
  const createdAt = data.createdAt;
  const updatedAt = data.updatedAt;

  if (
    typeof loopId !== 'string' ||
    typeof discordUserId !== 'string' ||
    typeof guildId !== 'string' ||
    typeof channelId !== 'string' ||
    typeof commitmentText !== 'string' ||
    typeof openedAt !== 'number' ||
    typeof closedAt !== 'number' ||
    typeof openDurationMs !== 'number' ||
    typeof proofType !== 'string' ||
    typeof reflectionStatus !== 'string' ||
    typeof createdAt !== 'number' ||
    typeof updatedAt !== 'number'
  ) {
    return null;
  }

  if (!snap.id) return null;

  const proofText = typeof data.proofText === 'string' ? data.proofText : undefined;
  const urls = data.proofAttachmentUrls;
  const proofAttachmentUrls = Array.isArray(urls)
    ? urls.filter((u: unknown): u is string => typeof u === 'string')
    : undefined;
  const proofMessageId =
    typeof data.proofMessageId === 'string' ? data.proofMessageId : undefined;
  const reflectionNotes =
    typeof data.reflectionNotes === 'string' ? data.reflectionNotes : undefined;

  return {
    id: snap.id,
    loopId,
    discordUserId,
    guildId,
    channelId,
    commitmentText,
    openedAt,
    closedAt,
    openDurationMs,
    proofType: proofType as ClosedLoop['proofType'],
    proofText,
    proofAttachmentUrls,
    proofMessageId,
    reflectionNotes,
    reflectionStatus: reflectionStatus as ClosedLoop['reflectionStatus'],
    createdAt,
    updatedAt,
  };
}

export class ClosedLoopRepo {
  constructor(private readonly db: Firestore = getFirestoreDb()) {}

  private collection() {
    return this.db.collection(EXECUTION_CLOSED_LOOPS);
  }

  async createClosedLoop(loop: ClosedLoop): Promise<string> {
    const ref = await this.collection().add(toFirestorePayload(loop));
    return ref.id;
  }

  /** Loops whose `openedAt` falls in `[startMs, endMsExclusive)`. */
  async countClosedWithOpenedAtInRange(
    discordUserId: string,
    range: TimestampRange,
  ): Promise<number> {
    if (!discordUserId) return 0;
    const q = await this.collection()
      .where('discordUserId', '==', discordUserId)
      .where('openedAt', '>=', range.startMs)
      .where('openedAt', '<', range.endMsExclusive)
      .limit(MAX_RANGE_QUERY)
      .get();
    return q.size;
  }

  /** Loops whose `closedAt` falls in `[startMs, endMsExclusive)`. */
  async countClosedWithClosedAtInRange(
    discordUserId: string,
    range: TimestampRange,
  ): Promise<number> {
    if (!discordUserId) return 0;
    const q = await this.collection()
      .where('discordUserId', '==', discordUserId)
      .where('closedAt', '>=', range.startMs)
      .where('closedAt', '<', range.endMsExclusive)
      .limit(MAX_RANGE_QUERY)
      .get();
    return q.size;
  }

  /** Sum `openDurationMs` for loops closed in range (cap: same query limit). */
  async sumOpenDurationMsClosedInRange(
    discordUserId: string,
    range: TimestampRange,
  ): Promise<number> {
    if (!discordUserId) return 0;
    const q = await this.collection()
      .where('discordUserId', '==', discordUserId)
      .where('closedAt', '>=', range.startMs)
      .where('closedAt', '<', range.endMsExclusive)
      .limit(MAX_RANGE_QUERY)
      .get();
    let sum = 0;
    for (const doc of q.docs) {
      const d = doc.data();
      const ms = d?.openDurationMs;
      if (typeof ms === 'number') sum += ms;
    }
    return sum;
  }

  /** Today's calendar range in `timeZone` (default Melbourne). */
  todayRange(
    timeZone: string = DEFAULT_BOT_TIMEZONE,
  ): TimestampRange {
    const dateKey = getTodayDateKey(timeZone);
    return getZonedDayUtcRange(dateKey, timeZone);
  }

  /** Closed loops in context with `closedAt` in `[startMs, endMsExclusive)`. */
  async listClosedInContextByClosedAtRange(
    guildId: string,
    channelId: string,
    range: TimestampRange,
  ): Promise<Array<ClosedLoop & { id: string }>> {
    const q = await this.collection()
      .where('guildId', '==', guildId)
      .where('channelId', '==', channelId)
      .where('closedAt', '>=', range.startMs)
      .where('closedAt', '<', range.endMsExclusive)
      .limit(MAX_RANGE_QUERY)
      .get();

    const loops: Array<ClosedLoop & { id: string }> = [];
    for (const doc of q.docs) {
      const mapped = mapSnapshotToClosedLoop(doc);
      if (mapped) loops.push(mapped);
    }
    loops.sort((a, b) => a.closedAt - b.closedAt);
    return loops;
  }

  async countClosedInContextByClosedAtRange(
    guildId: string,
    channelId: string,
    range: TimestampRange,
  ): Promise<number> {
    const query = this.collection()
      .where('guildId', '==', guildId)
      .where('channelId', '==', channelId)
      .where('closedAt', '>=', range.startMs)
      .where('closedAt', '<', range.endMsExclusive);
    const aggregate = await query.count().get();
    return aggregate.data().count;
  }

  async countClosedInContextAllTime(
    guildId: string,
    channelId: string,
  ): Promise<number> {
    const query = this.collection()
      .where('guildId', '==', guildId)
      .where('channelId', '==', channelId);
    const aggregate = await query.count().get();
    return aggregate.data().count;
  }
}
