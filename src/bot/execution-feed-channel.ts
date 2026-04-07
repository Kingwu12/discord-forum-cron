import type { Client, Message, MessageCreateOptions, TextBasedChannel, Webhook } from 'discord.js';
import {
  getExecutionFeedChannelId,
  getExecutionPanelChannelId,
  getExecutionPanelGuildId,
} from '../config/execution-panel-env';
import { buildExecutionFeedEmbed } from '../domains/execution/formatters/execution-feed-formatter';
import { ClosedLoopRepo } from '../domains/execution/repositories/closed-loop-repo';
import type { ReflectionStatus } from '../domains/execution/types/execution.types';
import { executionLog } from '../shared/logging';

export type ExecutionFeedPostParams = {
  userId: string;
  taskText: string;
  durationMs: number;
  reflectionStatus?: ReflectionStatus;
  proofText?: string;
  proofAttachmentUrls?: string[];
};

const EXECUTION_FEED_WEBHOOK_NAME = 'Execution Feed Relay';

/** After this many successful completion posts (since process start), inject a one-line activity signal. */
const FEED_TODAY_COUNT_INJECT_INTERVAL = 5;

let successfulFeedCompletionPosts = 0;

const closedLoopRepo = new ClosedLoopRepo();

/**
 * Subtle feed rhythm: after every N successful completion posts, sends a neutral one-liner
 * with today’s closed count (same calendar day + execution context as `/today` panel logic).
 * Plain `channel.send` — not user-styled webhook — so it reads as ambient feed copy.
 */
export async function maybeInjectTodayCountMessage(client: Client): Promise<void> {
  successfulFeedCompletionPosts += 1;
  if (successfulFeedCompletionPosts % FEED_TODAY_COUNT_INJECT_INTERVAL !== 0) return;

  const channelId = getExecutionFeedChannelId();
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !channel.isSendable()) {
    executionLog.warn('execution_feed_today_count_skipped_channel', { channelId });
    return;
  }

  try {
    const range = closedLoopRepo.todayRange();
    const count = await closedLoopRepo.countClosedInContextByClosedAtRange(
      getExecutionPanelGuildId(),
      getExecutionPanelChannelId(),
      range,
    );
    const content = `— ${count} loops closed today —`;
    await channel.send({ content });
    executionLog.info('execution_feed_today_count_injected', {
      channelId,
      count: String(count),
      interval: String(FEED_TODAY_COUNT_INJECT_INTERVAL),
    });
  } catch (err) {
    executionLog.warn('execution_feed_today_count_failed', {
      channelId,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

function inferProofFilenameFromUrl(url: string): string {
  const clean = url.split('?')[0] ?? url;
  const tail = clean.split('/').pop() ?? '';
  const hasImageExt = /\.(png|jpe?g|gif|webp|bmp)$/i.test(tail);
  if (hasImageExt) return tail;
  return 'proof.png';
}

function isWebhookCapableChannel(channel: TextBasedChannel): channel is TextBasedChannel & {
  fetchWebhooks: () => Promise<Awaited<ReturnType<TextBasedChannel['fetchWebhooks']>>>;
  createWebhook: (options: { name: string; reason?: string }) => Promise<Webhook>;
} {
  return 'fetchWebhooks' in channel && 'createWebhook' in channel;
}

async function getOrCreateFeedWebhook(
  client: Client,
  channel: TextBasedChannel,
): Promise<Webhook | null> {
  if (!isWebhookCapableChannel(channel)) return null;
  const hooks = await channel.fetchWebhooks();
  const reusable = hooks.find((hook) =>
    hook.token &&
    hook.isIncoming() &&
    (
      hook.applicationId === client.application?.id ||
      hook.owner?.id === client.user?.id
    ),
  );
  if (reusable) return reusable;
  return channel.createWebhook({
    name: EXECUTION_FEED_WEBHOOK_NAME,
    reason: 'Execution feed user-identity relay',
  });
}

export async function sendExecutionCompleteToFeed(
  client: Client,
  params: ExecutionFeedPostParams,
): Promise<void> {
  const channelId = getExecutionFeedChannelId();
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !channel.isSendable()) {
    executionLog.warn('execution_feed_post_skipped_channel_missing', { channelId });
    return;
  }
  const proofImageUrl = params.proofAttachmentUrls?.[0];
  const proofFilename = proofImageUrl ? inferProofFilenameFromUrl(proofImageUrl) : undefined;
  const proofImageRef = proofFilename ? `attachment://${proofFilename}` : undefined;

  const guild = 'guild' in channel && channel.guild ? channel.guild : null;
  const member = guild ? await guild.members.fetch(params.userId).catch(() => null) : null;
  const user = member?.user ?? (await client.users.fetch(params.userId).catch(() => null));
  const feedUsername =
    member?.displayName ?? user?.globalName ?? user?.username ?? params.userId;

  const embed = buildExecutionFeedEmbed({
    username: feedUsername,
    durationMs: params.durationMs,
    taskText: params.taskText?.trim() ?? '',
    proofImageRef,
  });
  const posted = await sendUserStyledChannelMessage(client, {
    channel,
    userId: params.userId,
    embeds: [embed],
    files: proofImageUrl && proofFilename ? [{ attachment: proofImageUrl, name: proofFilename }] : undefined,
    logPrefix: 'execution_feed',
  });

  if (posted) {
    await maybeInjectTodayCountMessage(client);
  }
}

export async function sendUserStyledChannelMessage(
  client: Client,
  params: {
    channel: TextBasedChannel;
    userId: string;
    embeds?: MessageCreateOptions['embeds'];
    content?: string;
    components?: MessageCreateOptions['components'];
    files?: MessageCreateOptions['files'];
    logPrefix: string;
  },
): Promise<Message | null> {
  const channel = params.channel;
  if (!channel.isSendable()) {
    executionLog.warn(`${params.logPrefix}_post_skipped_channel_unsendable`, {
      userId: params.userId,
      channelId: channel.id,
    });
    return null;
  }
  const guild = channel.isDMBased() ? null : channel.guild;
  const member = guild ? await guild.members.fetch(params.userId).catch(() => null) : null;
  const user = member?.user ?? await client.users.fetch(params.userId).catch(() => null);
  const displayName = member?.displayName ?? user?.globalName ?? user?.username ?? params.userId;
  const avatarURL = member?.displayAvatarURL() ?? user?.displayAvatarURL();

  try {
    const hook = await getOrCreateFeedWebhook(client, channel);
    if (!hook || !hook.token) {
      throw new Error('no_reusable_webhook');
    }
    const sent = await hook.send({
      username: displayName,
      avatarURL,
      content: params.content,
      embeds: params.embeds,
      components: params.components,
      files: params.files,
    });
    executionLog.info(`${params.logPrefix}_posted_via_webhook`, {
      channelId: channel.id,
      userId: params.userId,
      webhookId: hook.id,
    });
    return sent;
  } catch (err) {
    executionLog.warn(`${params.logPrefix}_webhook_failed_fallback_send`, {
      channelId: channel.id,
      userId: params.userId,
      reason: err instanceof Error ? err.message : String(err),
    });
    const sent = await channel.send({
      content: params.content,
      embeds: params.embeds,
      components: params.components,
      files: params.files,
    });
    executionLog.info(`${params.logPrefix}_posted_via_bot_fallback`, {
      channelId: channel.id,
      userId: params.userId,
    });
    return sent;
  }
}
