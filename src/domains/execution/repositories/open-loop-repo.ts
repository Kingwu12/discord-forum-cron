import type { DocumentReference, DocumentSnapshot, Firestore } from 'firebase-admin/firestore';

import { getFirestoreDb } from '../../../infra/firebase/firestore';
import type { OpenLoop } from '../types/execution.types';
import { EXECUTION_OPEN_LOOPS } from './execution-collections';

function toFirestorePayload(loop: OpenLoop): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    loopId: loop.loopId,
    discordUserId: loop.discordUserId,
    guildId: loop.guildId,
    channelId: loop.channelId,
    commitmentText: loop.commitmentText,
    status: loop.status,
    openedAt: loop.openedAt,
    createdAt: loop.createdAt,
    updatedAt: loop.updatedAt,
    schemaVersion: 1,
  };
  if (loop.loopPanelMessageId) payload.loopPanelMessageId = loop.loopPanelMessageId;
  if (loop.loopPanelChannelId) payload.loopPanelChannelId = loop.loopPanelChannelId;
  return payload;
}

function mapSnapshotToOpenLoop(snap: DocumentSnapshot): OpenLoop | null {
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;

  const loopId = data.loopId;
  const guildId = data.guildId;
  const channelId = data.channelId;
  const commitmentText = data.commitmentText;
  const loopPanelMessageId = data.loopPanelMessageId;
  const loopPanelChannelId = data.loopPanelChannelId;
  const openedAt = data.openedAt;
  const createdAt = data.createdAt;
  const updatedAt = data.updatedAt;

  if (
    typeof loopId !== 'string' ||
    typeof guildId !== 'string' ||
    typeof channelId !== 'string' ||
    typeof commitmentText !== 'string' ||
    typeof openedAt !== 'number' ||
    typeof createdAt !== 'number' ||
    typeof updatedAt !== 'number'
  ) {
    return null;
  }

  if (!snap.id) return null;

  return {
    loopId,
    discordUserId: snap.id,
    guildId,
    channelId,
    commitmentText,
    loopPanelMessageId: typeof loopPanelMessageId === 'string' ? loopPanelMessageId : undefined,
    loopPanelChannelId: typeof loopPanelChannelId === 'string' ? loopPanelChannelId : undefined,
    status: 'open',
    openedAt,
    createdAt,
    updatedAt,
  };
}

/** At most one open loop per Discord user (document id = discordUserId). */
export class OpenLoopRepo {
  constructor(private readonly db: Firestore = getFirestoreDb()) {}

  private collection() {
    return this.db.collection(EXECUTION_OPEN_LOOPS);
  }

  private docRef(discordUserId: string): DocumentReference {
    return this.collection().doc(discordUserId);
  }

  async getOpenLoop(discordUserId: string): Promise<OpenLoop | null> {
    if (!discordUserId) return null;
    const snap = await this.docRef(discordUserId).get();
    return mapSnapshotToOpenLoop(snap);
  }

  async createOpenLoop(loop: OpenLoop): Promise<void> {
    await this.docRef(loop.discordUserId).create(toFirestorePayload(loop));
  }

  async deleteOpenLoop(discordUserId: string): Promise<void> {
    if (!discordUserId) return;
    await this.docRef(discordUserId).delete();
  }

  async setLoopPanelRef(discordUserId: string, loopPanelMessageId: string, loopPanelChannelId: string): Promise<void> {
    if (!discordUserId || !loopPanelMessageId || !loopPanelChannelId) return;
    await this.docRef(discordUserId).set(
      { loopPanelMessageId, loopPanelChannelId, updatedAt: Date.now(), schemaVersion: 1 },
      { merge: true },
    );
  }

  async listOpenLoopsInContext(guildId: string, channelId: string, limitCount?: number): Promise<OpenLoop[]> {
    let query = this.collection().where('guildId', '==', guildId).where('channelId', '==', channelId);
    if (typeof limitCount === 'number' && Number.isFinite(limitCount) && limitCount > 0) {
      query = query.limit(Math.floor(limitCount));
    }
    const snap = await query.get();

    const loops: OpenLoop[] = [];
    for (const doc of snap.docs) {
      const mapped = mapSnapshotToOpenLoop(doc);
      if (mapped) loops.push(mapped);
    }
    return loops;
  }
}
