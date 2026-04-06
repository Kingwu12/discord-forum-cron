/**
 * Firestore collection names for the execution / Open Loop domain.
 *
 * Legacy collections (`execution_active_sessions`, `execution_sessions`) are left in Firestore
 * for historical data; v1 Open Loop writes use the collections below.
 *
 * Document ID strategy:
 * - execution_open_loops: one doc per user with an open loop; document ID = Discord user id.
 * - execution_closed_loops: auto-generated IDs; query by user + openedAt / closedAt.
 */

/** Open loop keyed by Discord user id. */
export const EXECUTION_OPEN_LOOPS = 'execution_open_loops';

/** Closed loops (proof + reflection). */
export const EXECUTION_CLOSED_LOOPS = 'execution_closed_loops';

/** Verdicts (future). */
export const EXECUTION_VERDICTS = 'execution_verdicts';

/** Single control-panel message id per execution channel (dedupe / restart restore). */
export const EXECUTION_PANEL_STATE = 'execution_panel_state';

export function getExecutionPanelStateDocPath(guildId: string, channelId: string): string {
  return `${EXECUTION_PANEL_STATE}/${guildId}_${channelId}`;
}

/** @deprecated Historical — do not write new session-shaped docs here */
export const EXECUTION_ACTIVE_SESSIONS = 'execution_active_sessions';

/** @deprecated Historical — do not write new session-shaped docs here */
export const EXECUTION_SESSIONS = 'execution_sessions';

export function getOpenLoopDocPath(discordUserId: string): string {
  return `${EXECUTION_OPEN_LOOPS}/${discordUserId}`;
}

export function getExecutionClosedLoopsCollectionPath(): string {
  return EXECUTION_CLOSED_LOOPS;
}

export function getExecutionVerdictsCollectionPath(): string {
  return EXECUTION_VERDICTS;
}
