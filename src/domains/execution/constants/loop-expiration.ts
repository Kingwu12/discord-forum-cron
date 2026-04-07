import type { OpenLoop } from '../types/execution.types';

/** Hard cap on how long an open loop may stay active before auto-expiry (2 hours). */
export const MAX_LOOP_DURATION_MS = 7200000; // 2 hours

/** Accepts Firestore `openedAt` or alias `startedAt` (same milliseconds). */
export type LoopStartTime = Pick<OpenLoop, 'openedAt'> | { startedAt: number };

function loopStartedAtMs(loop: LoopStartTime): number {
  return 'startedAt' in loop ? loop.startedAt : loop.openedAt;
}

/**
 * True when the loop has reached or exceeded the max open window (inclusive of exactly 2h).
 * Idempotent checks always use the same rule.
 */
export function isLoopExpired(loop: LoopStartTime, nowMs: number = Date.now()): boolean {
  return nowMs - loopStartedAtMs(loop) >= MAX_LOOP_DURATION_MS;
}

export function loopExpiresAtMs(loop: Pick<OpenLoop, 'openedAt'>): number {
  return loop.openedAt + MAX_LOOP_DURATION_MS;
}
