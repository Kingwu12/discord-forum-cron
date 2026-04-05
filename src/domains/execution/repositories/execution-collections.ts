/**
 * Firestore collection names and path helpers for the execution domain only.
 * MVP data is Discord-native and must not share collections with Mode Labs / site backends.
 *
 * Document ID strategy:
 * - execution_active_sessions: one doc per user in flight; document ID = Discord user snowflake (`discordUserId`).
 * - execution_sessions: completed / historical sessions; document ID = auto-generated (Firestore `doc()` or client UUID), assigned by the repository layer.
 * - execution_verdicts: verdict records; document ID = auto-generated, assigned by the repository layer.
 */

/** In-flight execution session keyed by Discord user ID. */
export const EXECUTION_ACTIVE_SESSIONS = 'execution_active_sessions';

/** Completed and historical execution sessions. */
export const EXECUTION_SESSIONS = 'execution_sessions';

/** Verdicts tied to execution sessions (via fields on the document, not path). */
export const EXECUTION_VERDICTS = 'execution_verdicts';

/** Full document path for an active session: `{collection}/{discordUserId}`. */
export function getActiveSessionDocPath(discordUserId: string): string {
  return `${EXECUTION_ACTIVE_SESSIONS}/${discordUserId}`;
}

/** Collection path segment for completed/historical sessions (top-level). */
export function getExecutionSessionsCollectionPath(): string {
  return EXECUTION_SESSIONS;
}

/** Collection path segment for verdicts (top-level). */
export function getExecutionVerdictsCollectionPath(): string {
  return EXECUTION_VERDICTS;
}
