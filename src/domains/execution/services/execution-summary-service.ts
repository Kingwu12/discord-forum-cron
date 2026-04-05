import type { ExecutionSession } from '../types/execution.types';

/**
 * Builds execution summaries for display (placeholder — no command wiring yet).
 */
export class ExecutionSummaryService {
  summarize(_session: ExecutionSession): string {
    throw new Error('ExecutionSummaryService.summarize not implemented');
  }
}
