import { ActiveSessionRepo } from '../repositories/active-session-repo';
import { SessionRepo } from '../repositories/session-repo';
import type { DiscordSnowflake, ExecutionActiveSession, ExecutionSession } from '../types/execution.types';

/** Fields required to open a new active session. */
export type StartSessionInput = Pick<
  ExecutionActiveSession,
  'discordUserId' | 'guildId' | 'channelId'
>;

export type StartSessionOk = {
  ok: true;
  activeSession: ExecutionActiveSession;
};

/** Another session is already open for this Discord user (one active per user). */
export type StartSessionAlreadyActive = {
  ok: false;
  reason: 'already_active';
  activeSession: ExecutionActiveSession;
};

export type StartSessionResult = StartSessionOk | StartSessionAlreadyActive;

export type EndSessionInput = {
  discordUserId: DiscordSnowflake;
};

export type EndSessionOk = {
  ok: true;
  completedSession: ExecutionSession;
  /** Firestore document ID of the completed session row */
  completedSessionId: string;
};

export type EndSessionNoActive = {
  ok: false;
  reason: 'no_active_session';
};

export type EndSessionResult = EndSessionOk | EndSessionNoActive;

function isAlreadyExistsError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const o = err as { code?: number | string; message?: string };
  if (o.code === 6 || o.code === 'already-exists') return true;
  return typeof o.message === 'string' && o.message.includes('ALREADY_EXISTS');
}

/**
 * Owns start/end lifecycle for execution sessions (active → completed).
 * Persistence only; no Discord or presentation logic.
 */
export class ExecutionSessionService {
  constructor(
    private readonly activeRepo: ActiveSessionRepo = new ActiveSessionRepo(),
    private readonly sessionRepo: SessionRepo = new SessionRepo(),
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async getActiveSessionForUser(
    discordUserId: DiscordSnowflake,
  ): Promise<ExecutionActiveSession | null> {
    return this.activeRepo.getActiveSession(discordUserId);
  }

  async startSession(input: StartSessionInput): Promise<StartSessionResult> {
    const existing = await this.activeRepo.getActiveSession(input.discordUserId);
    if (existing) {
      return { ok: false, reason: 'already_active', activeSession: existing };
    }

    const now = this.clock();
    const activeSession: ExecutionActiveSession = {
      discordUserId: input.discordUserId,
      guildId: input.guildId,
      channelId: input.channelId,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.activeRepo.createActiveSession(activeSession);
    } catch (err) {
      if (isAlreadyExistsError(err)) {
        const concurrent = await this.activeRepo.getActiveSession(input.discordUserId);
        if (concurrent) {
          return { ok: false, reason: 'already_active', activeSession: concurrent };
        }
      }
      throw err;
    }

    return { ok: true, activeSession };
  }

  async endSession(input: EndSessionInput): Promise<EndSessionResult> {
    const active = await this.activeRepo.getActiveSession(input.discordUserId);
    if (!active) {
      return { ok: false, reason: 'no_active_session' };
    }

    const now = this.clock();
    const endedAt = now;
    const durationMs = Math.max(0, endedAt - active.startedAt);

    const completedSession: ExecutionSession = {
      discordUserId: active.discordUserId,
      guildId: active.guildId,
      channelId: active.channelId,
      startedAt: active.startedAt,
      endedAt,
      durationMs,
      createdAt: active.createdAt,
      updatedAt: now,
    };

    const completedSessionId = await this.sessionRepo.createSession(completedSession);
    await this.activeRepo.deleteActiveSession(input.discordUserId);

    return { ok: true, completedSession, completedSessionId };
  }
}
