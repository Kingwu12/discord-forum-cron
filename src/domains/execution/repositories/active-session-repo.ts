import type { DocumentReference, DocumentSnapshot, Firestore } from 'firebase-admin/firestore';

import { getFirestoreDb } from '../../../infra/firebase/firestore';
import type { ExecutionActiveSession } from '../types/execution.types';
import { EXECUTION_ACTIVE_SESSIONS } from './execution-collections';

function toFirestorePayload(session: ExecutionActiveSession): Record<string, unknown> {
  return {
    discordUserId: session.discordUserId,
    guildId: session.guildId,
    channelId: session.channelId,
    startedAt: session.startedAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function mapSnapshotToActiveSession(snap: DocumentSnapshot): ExecutionActiveSession | null {
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;

  const guildId = data.guildId;
  const channelId = data.channelId;
  const startedAt = data.startedAt;
  const createdAt = data.createdAt;
  const updatedAt = data.updatedAt;

  if (
    typeof guildId !== 'string' ||
    typeof channelId !== 'string' ||
    typeof startedAt !== 'number' ||
    typeof createdAt !== 'number' ||
    typeof updatedAt !== 'number'
  ) {
    return null;
  }

  if (!snap.id) return null;

  return {
    discordUserId: snap.id,
    guildId,
    channelId,
    startedAt,
    createdAt,
    updatedAt,
  };
}

/**
 * Active execution sessions: at most one document per Discord user (document ID = discordUserId).
 */
export class ActiveSessionRepo {
  constructor(private readonly db: Firestore = getFirestoreDb()) {}

  private collection() {
    return this.db.collection(EXECUTION_ACTIVE_SESSIONS);
  }

  private docRef(discordUserId: string): DocumentReference {
    return this.collection().doc(discordUserId);
  }

  async getActiveSession(discordUserId: string): Promise<ExecutionActiveSession | null> {
    if (!discordUserId) return null;
    const snap = await this.docRef(discordUserId).get();
    return mapSnapshotToActiveSession(snap);
  }

  /**
   * Creates the active session document. Fails if a document already exists for this user
   * (Firestore `ALREADY_EXISTS` / gRPC 6) — callers may treat that as a conflict at a higher layer.
   */
  async createActiveSession(session: ExecutionActiveSession): Promise<void> {
    await this.docRef(session.discordUserId).create(toFirestorePayload(session));
  }

  /** Removes the active session document if present. */
  async deleteActiveSession(discordUserId: string): Promise<void> {
    if (!discordUserId) return;
    await this.docRef(discordUserId).delete();
  }

  /** Writes the full session payload; document ID is always session.discordUserId. */
  async upsertActiveSession(session: ExecutionActiveSession): Promise<void> {
    await this.docRef(session.discordUserId).set(toFirestorePayload(session));
  }
}
