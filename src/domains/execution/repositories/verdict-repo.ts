import type { ExecutionVerdict } from '../types/execution.types';

/**
 * Verdict persistence (placeholder — no Firestore yet).
 */
export class VerdictRepo {
  save(_verdict: ExecutionVerdict): void {
    throw new Error('VerdictRepo.save not implemented');
  }

  getByLoopId(_loopId: string): ExecutionVerdict | null {
    return null;
  }
}
