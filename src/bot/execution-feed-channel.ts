import type { Client } from 'discord.js';

import { getExecutionFeedChannelId } from '../config/execution-panel-env';
import {
  buildExecutionCompleteEmbed,
  type ExecutionCompleteFeedParams,
} from '../domains/execution/formatters/execution-feed-formatter';
import { executionLog } from '../shared/logging';

export async function sendExecutionCompleteToFeed(
  client: Client,
  params: ExecutionCompleteFeedParams,
): Promise<void> {
  const feedChannelId = getExecutionFeedChannelId();
  try {
    const ch = await client.channels.fetch(feedChannelId);
    if (!ch?.isSendable()) {
      executionLog.warn('execution_feed_send_skipped', {
        reason: 'channel_not_sendable',
        feedChannelId,
      });
      return;
    }
    await ch.send({ embeds: [buildExecutionCompleteEmbed(params)] });
  } catch (err) {
    executionLog.error('execution_feed_send_failed', { feedChannelId }, err);
  }
}
