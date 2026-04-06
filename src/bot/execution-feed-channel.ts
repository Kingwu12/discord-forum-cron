import type { Client } from 'discord.js';
import type { SuggestedClosePostParams } from '../domains/execution/formatters/execution-feed-formatter';
import { executionLog } from '../shared/logging';

/**
 * Deprecated by design: user must post closes in execution-feed manually.
 * This remains as a guarded no-op to prevent accidental bot-authored feed posts.
 */
export async function sendExecutionCompleteToFeed(
  _client: Client,
  _params: SuggestedClosePostParams,
): Promise<void> {
  executionLog.info('execution_feed_post_skipped_manual_mode', {
    reason: 'user_posts_close_manually',
  });
}
