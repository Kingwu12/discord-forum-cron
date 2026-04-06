import type { ClosedLoop } from '../types/execution.types';

/**
 * Builds loop summaries for display (placeholder — no command wiring yet).
 */
export class ExecutionSummaryService {
  summarize(_loop: ClosedLoop): string {
    throw new Error('ExecutionSummaryService.summarize not implemented');
  }
}
