import { randomUUID } from 'node:crypto';

import { isLoopExpired } from '../constants/loop-expiration';

/** Re-export: max open-loop window is defined alongside {@link isLoopExpired}. */
export { MAX_LOOP_DURATION_MS, isLoopExpired } from '../constants/loop-expiration';
import { ClosedLoopRepo } from '../repositories/closed-loop-repo';
import { OpenLoopRepo } from '../repositories/open-loop-repo';
import type {
  ClosedLoop,
  DiscordSnowflake,
  OpenLoop,
  ProofType,
  ReflectionStatus,
} from '../types/execution.types';

export type OpenLoopInput = {
  discordUserId: DiscordSnowflake;
  guildId: DiscordSnowflake;
  channelId: DiscordSnowflake;
  commitmentText: string;
};

export type OpenLoopOk = { ok: true; openLoop: OpenLoop };

export type OpenLoopBlocked = {
  ok: false;
  reason: 'already_open';
  openLoop: OpenLoop;
};

export type OpenLoopResult = OpenLoopOk | OpenLoopBlocked;

export type CloseLoopInput = {
  discordUserId: DiscordSnowflake;
  proofText?: string;
  proofAttachmentUrls?: string[];
  /** Discord proof message id when closing from the execution channel. */
  proofMessageId?: string;
  /** Defaults to `partial` when omitted (e.g. panel modal). */
  reflectionStatus?: ReflectionStatus;
  reflectionNotes?: string;
};

export type CloseLoopOk = {
  ok: true;
  closedLoop: ClosedLoop;
  closedLoopFirestoreId: string;
};

export type CloseLoopNoOpen = { ok: false; reason: 'no_open_loop' };

export type CloseLoopExpired = {
  ok: false;
  reason: 'expired';
  /** Snapshot for Discord cleanup (panel message delete) after Firestore doc is removed. */
  openLoop: OpenLoop;
};

export type CloseLoopResult = CloseLoopOk | CloseLoopNoOpen | CloseLoopExpired;

function isAlreadyExistsError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const o = err as { code?: number | string; message?: string };
  if (o.code === 6 || o.code === 'already-exists') return true;
  return typeof o.message === 'string' && o.message.includes('ALREADY_EXISTS');
}

function deriveProofType(hasFile: boolean, text: string): ProofType {
  const hasText = text.length > 0;
  if (hasFile && hasText) return 'mixed';
  if (hasFile) return 'attachment';
  if (/^https?:\/\//i.test(text)) return 'link';
  return 'text';
}

/**
 * Open Loop lifecycle: one open document per user; close writes to closed collection.
 */
export class LoopService {
  constructor(
    private readonly openRepo: OpenLoopRepo = new OpenLoopRepo(),
    private readonly closedRepo: ClosedLoopRepo = new ClosedLoopRepo(),
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async getOpenLoopForUser(discordUserId: DiscordSnowflake): Promise<OpenLoop | null> {
    return this.openRepo.getOpenLoop(discordUserId);
  }

  async openLoop(input: OpenLoopInput): Promise<OpenLoopResult> {
    const existing = await this.openRepo.getOpenLoop(input.discordUserId);
    if (existing) {
      return { ok: false, reason: 'already_open', openLoop: existing };
    }

    const now = this.clock();
    const loopId = randomUUID();
    const openLoop: OpenLoop = {
      loopId,
      discordUserId: input.discordUserId,
      guildId: input.guildId,
      channelId: input.channelId,
      commitmentText: input.commitmentText.trim(),
      status: 'active',
      openedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.openRepo.createOpenLoop(openLoop);
    } catch (err) {
      if (isAlreadyExistsError(err)) {
        const concurrent = await this.openRepo.getOpenLoop(input.discordUserId);
        if (concurrent) {
          return { ok: false, reason: 'already_open', openLoop: concurrent };
        }
      }
      throw err;
    }

    return { ok: true, openLoop };
  }

  async closeLoop(input: CloseLoopInput): Promise<CloseLoopResult> {
    const open = await this.openRepo.getOpenLoop(input.discordUserId);
    if (!open) {
      return { ok: false, reason: 'no_open_loop' };
    }

    const now = this.clock();
    if (isLoopExpired(open, now)) {
      const openLoop = open;
      await this.openRepo.deleteOpenLoop(input.discordUserId);
      return { ok: false, reason: 'expired', openLoop };
    }
    const proofTextRaw = input.proofText?.trim() ?? '';
    const urls = input.proofAttachmentUrls?.filter(Boolean) ?? [];
    const hasFile = urls.length > 0;
    const proofType = deriveProofType(hasFile, proofTextRaw);

    const reflectionStatus: ReflectionStatus = input.reflectionStatus ?? 'partial';
    const notesRaw = input.reflectionNotes?.trim() ?? '';

    const closedLoop: ClosedLoop = {
      loopId: open.loopId,
      discordUserId: open.discordUserId,
      guildId: open.guildId,
      channelId: open.channelId,
      commitmentText: open.commitmentText,
      openedAt: open.openedAt,
      closedAt: now,
      openDurationMs: Math.max(0, now - open.openedAt),
      proofType,
      proofText: proofTextRaw.length > 0 ? proofTextRaw : undefined,
      proofAttachmentUrls: urls.length > 0 ? urls : undefined,
      reflectionStatus,
      createdAt: open.createdAt,
      updatedAt: now,
    };
    if (input.proofMessageId !== undefined && input.proofMessageId.length > 0) {
      closedLoop.proofMessageId = input.proofMessageId;
    }
    if (notesRaw.length > 0) {
      closedLoop.reflectionNotes = notesRaw.slice(0, 2000);
    }

    const closedLoopFirestoreId = await this.closedRepo.createClosedLoop(closedLoop);
    await this.openRepo.deleteOpenLoop(input.discordUserId);

    return { ok: true, closedLoop, closedLoopFirestoreId };
  }
}
