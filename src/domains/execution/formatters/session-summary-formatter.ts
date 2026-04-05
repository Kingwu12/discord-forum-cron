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

/**
 * Duration for public session-complete lines (includes seconds when relevant), e.g. `6m 32s`, `2h 14m 5s`.
 */
export function formatExecutionDurationForPublicComplete(durationMs: number): string {
  const ms = clampNonNegativeMs(durationMs);
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (hours > 0) {
    if (minutes > 0 && seconds > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${hours}h ${minutes}m`;
    if (seconds > 0) return `${hours}h ${seconds}s`;
    return `${hours}h`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  if (seconds > 0) return `${seconds}s`;
  return '< 1m';
}

/** Ephemeral / DM line when `/today` has nothing to show for the calendar day. */
export const TODAY_SUMMARY_EMPTY = 'No completed sessions today.';

/**
 * One-line daily rollup for `/today` (session count + summed duration).
 */
export function formatTodayExecutionSummary(
  sessionCount: number,
  totalDurationMs: number,
): string {
  if (sessionCount <= 0) return TODAY_SUMMARY_EMPTY;
  const duration = formatExecutionDurationMs(totalDurationMs);
  const noun = sessionCount === 1 ? 'session' : 'sessions';
  return `Today: ${sessionCount} ${noun} · ${duration} total.`;
}

export type PublicSessionCompleteInput = {
  discordUserId: string;
  durationMs: number;
};

/**
 * Line posted to a channel when a session completes (mention + duration).
 */
export function formatPublicSessionCompleteMessage(input: PublicSessionCompleteInput): string {
  const duration = formatExecutionDurationForPublicComplete(input.durationMs);
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
