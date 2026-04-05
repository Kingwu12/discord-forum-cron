import type { ExecutionSession } from '../types/execution.types';

function clampNonNegativeMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return ms;
}

/**
 * Human-readable duration for chat (e.g. `2h 14m`, `45m`, `< 1m`).
 * Omits zero parts; does not gamify or score.
 */
export function formatExecutionDurationMs(durationMs: number): string {
  const ms = clampNonNegativeMs(durationMs);
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return '< 1m';
}

export type PublicSessionCompleteInput = {
  discordUserId: string;
  durationMs: number;
};

/**
 * Line posted to a channel when a session completes (mention + duration).
 */
export function formatPublicSessionCompleteMessage(input: PublicSessionCompleteInput): string {
  const duration = formatExecutionDurationMs(input.durationMs);
  return `<@${input.discordUserId}> completed a ${duration} execution session.`;
}

/**
 * Short confirmation for DMs or ephemeral follow-ups (no mention).
 */
export function formatPrivateSessionCompleteConfirmation(durationMs: number): string {
  const duration = formatExecutionDurationMs(durationMs);
  return `Session complete (${duration}). Logged.`;
}

/** Public completion line from a persisted {@link ExecutionSession}. */
export function formatSessionSummary(session: ExecutionSession): string {
  return formatPublicSessionCompleteMessage({
    discordUserId: session.discordUserId,
    durationMs: session.durationMs,
  });
}
