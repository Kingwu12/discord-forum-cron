import type { Firestore } from 'firebase-admin/firestore';

import { getFirestoreDb } from '../../../infra/firebase/firestore';
import { getExecutionPanelStateDocPath } from './execution-collections';

export type ExecutionPanelStateDoc = {
  panelMessageId: string;
  updatedAt: number;
};

export class ExecutionPanelStateRepo {
  constructor(private readonly db: Firestore = getFirestoreDb()) {}

  private ref(guildId: string, channelId: string) {
    return this.db.doc(getExecutionPanelStateDocPath(guildId, channelId));
  }

  async getPanelMessageId(guildId: string, channelId: string): Promise<string | null> {
    const snap = await this.ref(guildId, channelId).get();
    if (!snap.exists) return null;
    const data = snap.data();
    const id = data?.panelMessageId;
    return typeof id === 'string' && id.length > 0 ? id : null;
  }

  async setPanelMessageId(
    guildId: string,
    channelId: string,
    panelMessageId: string,
  ): Promise<void> {
    const now = Date.now();
    await this.ref(guildId, channelId).set(
      { panelMessageId, updatedAt: now, schemaVersion: 1 },
      { merge: true },
    );
  }
}
