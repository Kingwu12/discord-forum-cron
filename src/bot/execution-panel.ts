import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type Client,
  ComponentType,
  EmbedBuilder,
  type GuildTextBasedChannel,
  type Message,
  ModalBuilder,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import {
  getActiveLoopsChannelId,
  getExecutionPanelChannelId,
  getExecutionPanelGuildId,
  isExecutionPanelConfigured,
} from '../config/execution-panel-env';
import { isLoopExpired, loopExpiresAtMs } from '../domains/execution/constants/loop-expiration';
import { sendExecutionCompleteToFeed, sendUserStyledChannelMessage } from './execution-feed-channel';
import { ClosedLoopRepo } from '../domains/execution/repositories/closed-loop-repo';
import { ExecutionPanelStateRepo } from '../domains/execution/repositories/execution-panel-state-repo';
import { OpenLoopRepo } from '../domains/execution/repositories/open-loop-repo';
import { formatElapsedCompact } from '../domains/execution/formatters/loop-cockpit-embed';
import { buildAlreadyOpenLoopReply } from '../domains/execution/formatters/open-loop-link';
import { sanitizeCommitmentDisplay } from '../domains/execution/formatters/loop-formatters';
import {
  executionAccessService,
  toExecutionAccessContext,
} from '../domains/execution/services/execution-access-service';
import {
  hasLoopAccessMember,
  LOOP_ACCESS_GATE_MESSAGE,
  requireLoopAccess,
} from '../domains/execution/services/loop-access-guard';
import { LoopService } from '../domains/execution/services/loop-service';
import { buildTodayClosedLoopsSummaryForContext } from '../domains/execution/services/today-loops-summary';
import type { OpenLoop } from '../domains/execution/types/execution.types';
import { logEvent } from '../shared/analytics/loop-behavior-analytics';
import { executionLog } from '../shared/logging';

const loopService = new LoopService();
const panelStateRepo = new ExecutionPanelStateRepo();
const openLoopRepo = new OpenLoopRepo();
const closedLoopRepo = new ClosedLoopRepo();

/** Ephemeral copy when a close is attempted on an expired loop (see `isLoopExpired`). */
export const LOOP_EXPIRED_USER_MESSAGE = 'That loop expired.\nStart a new one.';

export const PANEL_BUTTON_OPEN = 'citadel:exec:open';
export const PANEL_BUTTON_TODAY = 'citadel:exec:today';
export const PANEL_BUTTON_ACTIVE_MORE = 'citadel:exec:active:more';
export const LOOP_PANEL_BUTTON_CLOSE_PREFIX = 'citadel:exec:loop:close:';
const MODAL_START = 'citadel:modal:start';
const MODAL_END = 'citadel:modal:end';
const INPUT_COMMITMENT = 'commitment';
const INPUT_PROOF = 'proof';
const INPUT_REFLECTION = 'reflection';
const ACTIVE_FETCH_LIMIT = 20;
const ACTIVE_VISIBLE_LIMIT = 3;
const PANEL_TICK_INTERVAL_MS = 15000;
const CLOSE_PROOF_REQUIRED_MESSAGE = 'Drop proof before closing — one line or an image is enough.';
const OPEN_INTENTION_INVALID_MESSAGE = 'Be specific — what are you actually building or doing?';
const OPEN_INTENTION_MIN_LENGTH = 8;
const lastIntervalRenderByContext = new Map<string, string>();
const PANEL_EMBED_COLOR_ACTIVE = 0x00ff94;
const PANEL_EMBED_COLOR_IDLE = 0xff3b3b;

export type EnsurePanelResult =
  | { ok: true; action: 'created' | 'updated'; panelMessageId: string }
  | { ok: false; reason: string };

function panelContextOrNull(interaction: ButtonInteraction): {
  guildId: string;
  channelId: string;
} | null {
  if (!interaction.inGuild() || interaction.guildId === null || interaction.channelId === null) {
    return null;
  }
  return { guildId: interaction.guildId, channelId: interaction.channelId };
}

function modalPanelContextOrNull(interaction: ModalSubmitInteraction): {
  guildId: string;
  channelId: string;
} | null {
  if (!interaction.inGuild() || interaction.guildId === null || interaction.channelId === null) {
    return null;
  }
  return { guildId: interaction.guildId, channelId: interaction.channelId };
}

function isConfiguredPanelChannel(guildId: string, channelId: string): boolean {
  return guildId === getExecutionPanelGuildId() && channelId === getExecutionPanelChannelId();
}

function isConfiguredActiveLoopsChannel(guildId: string, channelId: string): boolean {
  return guildId === getExecutionPanelGuildId() && channelId === getActiveLoopsChannelId();
}

function messageIsOurPanel(message: Message, clientId: string | undefined): boolean {
  if (!clientId || message.author.id !== clientId) return false;
  for (const row of message.components) {
    if (row.type !== ComponentType.ActionRow) continue;
    for (const comp of row.components) {
      if ('customId' in comp && comp.customId === PANEL_BUTTON_OPEN) return true;
    }
  }
  return false;
}

function isNonWorkIntention(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const nonWorkPatterns = [
    /^(just\s+)?survive$/,
    /^(just\s+)?exist$/,
    /^(just\s+)?don'?t die$/,
    /^(just\s+)?stay alive$/,
  ];
  return nonWorkPatterns.some((pattern) => pattern.test(normalized));
}

function isFirestoreMissingIndexError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const o = err as { code?: number | string; message?: string; details?: string };
  const message = `${o.message ?? ''} ${o.details ?? ''}`.toLowerCase();
  return (
    o.code === 9 || o.code === '9' || (message.includes('failed_precondition') && message.includes('requires an index'))
  );
}

function formatPanelClock(now: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(now);
}

async function buildPanelEmbed(
  client: Client,
  guildId: string,
  channelId: string,
  _focusUserId: string | null,
): Promise<EmbedBuilder> {
  const stale = await openLoopRepo.listOpenLoopsInContext(guildId, channelId, ACTIVE_FETCH_LIMIT);
  for (const loop of stale) {
    if (isLoopExpired(loop)) await runExpiredLoopCleanupForUser(client, loop.discordUserId);
  }
  const openLoops = await openLoopRepo.listOpenLoopsInContext(guildId, channelId, ACTIVE_FETCH_LIMIT);
  const sortedOpenLoops = [...openLoops].sort((a, b) => a.openedAt - b.openedAt);
  const activeCount = sortedOpenLoops.length;
  const shown = sortedOpenLoops.slice(0, ACTIVE_VISIBLE_LIMIT);
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const activeEntries = await Promise.all(
    shown.map(async (loop) => {
      return `▸ <@${loop.discordUserId}> — ${formatElapsedCompact(loop.openedAt)}`;
    }),
  );
  const remainder = Math.max(0, activeCount - activeEntries.length);
  const activeValue =
    activeEntries.length > 0
      ? [...activeEntries, remainder > 0 ? `+${remainder}` : ''].filter(Boolean).join('\n')
      : 'No active loops.';
  let todayValue = '—';
  let totalValue = '—';
  try {
    const todayRange = closedLoopRepo.todayRange();
    const closedToday = await closedLoopRepo.countClosedInContextByClosedAtRange(guildId, channelId, todayRange);
    const totalClosed = await closedLoopRepo.countClosedInContextAllTime(guildId, channelId);
    todayValue = String(closedToday);
    totalValue = String(totalClosed);
  } catch (err) {
    if (isFirestoreMissingIndexError(err)) {
      executionLog.warn('execution_panel_metrics_unavailable_missing_index', {
        guildId,
        channelId,
      });
    } else {
      throw err;
    }
  }

  const now = new Date();
  const description = '● LIVE';

  return new EmbedBuilder()
    .setColor(activeCount > 0 ? PANEL_EMBED_COLOR_ACTIVE : PANEL_EMBED_COLOR_IDLE)
    .setDescription(description)
    .addFields(
      { name: '◈ EXECUTING NOW', value: activeValue, inline: false },
      { name: '\u200B', value: '\u200B', inline: false },
      { name: '\u200B', value: `◈ TODAY: ${todayValue}\n◈ TOTAL: ${totalValue}`, inline: false },
    )
    .setFooter({ text: `MODE LABS · updated at ${formatPanelClock(now)}` });
}

function buildPanelComponents(guildId: string, overflowCount: number): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PANEL_BUTTON_OPEN).setLabel('Open Loop').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(PANEL_BUTTON_TODAY).setLabel('Today').setStyle(ButtonStyle.Secondary),
  );
  if (overflowCount > 0) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(PANEL_BUTTON_ACTIVE_MORE)
        .setLabel(`+${overflowCount}`)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('View all')
        .setURL(`https://discord.com/channels/${guildId}/${getActiveLoopsChannelId()}`),
    );
  }
  return [row];
}

function buildStartModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(MODAL_START)
    .setTitle('INITIATE LOOP')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(INPUT_COMMITMENT)
          .setLabel('DEFINE EXECUTION')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(400)
          .setRequired(true)
          .setPlaceholder('e.g. build login flow, finish lecture notes, edit 3 clips'),
      ),
    );
}

function buildEndModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(MODAL_END)
    .setTitle('CLOSE LOOP')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(INPUT_PROOF)
          .setLabel('WHAT WAS EXECUTED')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(2000)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(INPUT_REFLECTION)
          .setLabel('PROOF')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(true),
      ),
    );
}

function buildLoopPanelCloseCustomId(ownerUserId: string): string {
  return `${LOOP_PANEL_BUTTON_CLOSE_PREFIX}${ownerUserId}`;
}

function ownerUserIdFromLoopPanelCloseCustomId(customId: string): string | null {
  if (!customId.startsWith(LOOP_PANEL_BUTTON_CLOSE_PREFIX)) return null;
  const ownerUserId = customId.slice(LOOP_PANEL_BUTTON_CLOSE_PREFIX.length).trim();
  return ownerUserId.length > 0 ? ownerUserId : null;
}

function buildActiveLoopPanelEmbed(params: {
  taskText: string;
  openedAt: number;
  status: 'active' | 'awaiting_snap';
}): EmbedBuilder {
  const statusLabel = params.status === 'awaiting_snap' ? 'AWAITING SNAP' : 'LIVE';
  const helper = params.status === 'awaiting_snap' ? '\nUPLOAD: image to close' : '';
  const executing = sanitizeCommitmentDisplay(params.taskText, 500) || '—';
  return new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle('LOOP OPEN')
    .setDescription(
      [
        `EXECUTING: ${executing}`,
        `TIME IN: ${formatElapsedCompact(params.openedAt)}`,
        `STATUS: ${statusLabel}${helper}`,
      ].join('\n'),
    );
}

function buildActiveLoopPanelComponents(
  ownerUserId: string,
  status: 'active' | 'awaiting_snap',
): ActionRowBuilder<ButtonBuilder>[] {
  const isAwaitingSnap = status === 'awaiting_snap';
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildLoopPanelCloseCustomId(ownerUserId))
        .setLabel('Close Loop')
        .setDisabled(isAwaitingSnap)
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

export async function createActiveLoopPanelMessage(
  client: Client,
  openLoop: {
    discordUserId: string;
    commitmentText: string;
    openedAt: number;
  },
): Promise<void> {
  const guild = await client.guilds.fetch(getExecutionPanelGuildId()).catch(() => null);
  if (!guild) return;
  const channel = await guild.channels.fetch(getActiveLoopsChannelId()).catch(() => null);
  if (!channel || !channel.isTextBased() || !channel.isSendable()) return;
  const msg = await sendUserStyledChannelMessage(client, {
    channel,
    userId: openLoop.discordUserId,
    embeds: [
      buildActiveLoopPanelEmbed({ taskText: openLoop.commitmentText, openedAt: openLoop.openedAt, status: 'active' }),
    ],
    components: buildActiveLoopPanelComponents(openLoop.discordUserId, 'active'),
    logPrefix: 'active_loop_panel',
  });
  if (!msg) return;
  await openLoopRepo.setLoopPanelRef(openLoop.discordUserId, msg.id, channel.id);
  scheduleLoopExpiration(client, openLoop);
}

async function fetchActiveLoopPanelMessage(
  client: Client,
  openLoop: {
    guildId: string;
    loopPanelChannelId?: string;
    loopPanelMessageId?: string;
  },
): Promise<Message | null> {
  if (!openLoop.loopPanelMessageId) return null;
  const guild = await client.guilds.fetch(openLoop.guildId).catch(() => null);
  if (!guild) return null;
  const targetChannelId = openLoop.loopPanelChannelId || getActiveLoopsChannelId();
  const channel = await guild.channels.fetch(targetChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  return channel.messages.fetch(openLoop.loopPanelMessageId).catch(() => null);
}

export async function ensureActiveLoopPanelForOpenLoop(client: Client, openLoop: OpenLoop): Promise<OpenLoop> {
  const existingMessage = await fetchActiveLoopPanelMessage(client, openLoop);
  if (existingMessage) return openLoop;
  await createActiveLoopPanelMessage(client, openLoop);
  const refreshed = await openLoopRepo.getOpenLoop(openLoop.discordUserId);
  return refreshed ?? openLoop;
}

export async function restoreOrphanedActiveLoopPanels(client: Client): Promise<void> {
  const openLoops = await openLoopRepo.listAllOpenLoops(500);
  for (const openLoop of openLoops) {
    if (isLoopExpired(openLoop)) {
      await runExpiredLoopCleanupForUser(client, openLoop.discordUserId);
      continue;
    }
    const beforeMessageId = openLoop.loopPanelMessageId;
    const healed = await ensureActiveLoopPanelForOpenLoop(client, openLoop);
    if (healed.loopPanelMessageId && healed.loopPanelMessageId !== beforeMessageId) {
      executionLog.info('active_loop_panel_restored', {
        sessionId: openLoop.loopId,
        userId: openLoop.discordUserId,
        messageId: healed.loopPanelMessageId,
      });
    }
  }
}

export async function deleteActiveLoopPanelMessage(
  client: Client,
  openLoop: {
    guildId: string;
    loopPanelChannelId?: string;
    loopPanelMessageId?: string;
  },
): Promise<void> {
  if (!openLoop.loopPanelMessageId) return;
  const guild = await client.guilds.fetch(openLoop.guildId).catch(() => null);
  if (!guild) return;
  const targetChannelId = openLoop.loopPanelChannelId || getActiveLoopsChannelId();
  const channel = await guild.channels.fetch(targetChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  await channel.messages
    .fetch(openLoop.loopPanelMessageId)
    .then((m) => m.delete())
    .catch(() => {});
}

const loopExpirationTimers = new Map<string, NodeJS.Timeout>();

export function cancelLoopExpirationTimer(discordUserId: string): void {
  const t = loopExpirationTimers.get(discordUserId);
  if (t) {
    clearTimeout(t);
    loopExpirationTimers.delete(discordUserId);
  }
}

/**
 * Idempotent expiry: best-effort delete panel message, remove open-loop doc, refresh panel.
 * Safe if the message or doc is already gone (no throw to callers).
 */
export async function expireLoop(client: Client, loop: OpenLoop): Promise<void> {
  cancelLoopExpirationTimer(loop.discordUserId);
  try {
    await deleteActiveLoopPanelMessage(client, loop);
  } catch {
    /* ignore */
  }
  try {
    await openLoopRepo.deleteOpenLoop(loop.discordUserId);
  } catch {
    /* ignore */
  }
  try {
    await ensureExecutionPanel(client, { source: 'loop_expired', userId: loop.discordUserId });
  } catch {
    /* ignore */
  }

  let username = loop.discordUserId;
  try {
    const guild = await client.guilds.fetch(loop.guildId).catch(() => null);
    const member = guild ? await guild.members.fetch(loop.discordUserId).catch(() => null) : null;
    const user = member?.user ?? (await client.users.fetch(loop.discordUserId).catch(() => null));
    username = member?.displayName ?? user?.globalName ?? user?.username ?? loop.discordUserId;
  } catch {
    /* keep id */
  }
  void logEvent(client, 'EXPIRE', { userId: loop.discordUserId, username });
}

/** Lazy cleanup: if this user’s open loop is past max duration, run {@link expireLoop}. */
export async function runExpiredLoopCleanupForUser(client: Client, discordUserId: string): Promise<void> {
  const open = await openLoopRepo.getOpenLoop(discordUserId);
  if (!open || !isLoopExpired(open)) return;
  await expireLoop(client, open);
}

/** Alias: run expired cleanup for one user (open/close interaction hygiene). */
export const cleanupExpiredLoopsForUser = runExpiredLoopCleanupForUser;

/** Call before opening a new loop so an expired row + panel message do not block `/start` or the modal. */
export async function purgeExpiredLoopBeforeOpen(client: Client, discordUserId: string): Promise<void> {
  await cleanupExpiredLoopsForUser(client, discordUserId);
}

/**
 * One-shot timer for this user’s loop; fires {@link runExpiredLoopCleanupForUser} when the window elapses.
 * Does not edit messages on an interval — only this single timeout per open.
 */
export function scheduleLoopExpiration(
  client: Client,
  loop: Pick<OpenLoop, 'discordUserId' | 'openedAt'>,
): void {
  cancelLoopExpirationTimer(loop.discordUserId);
  const timeLeft = loopExpiresAtMs(loop) - Date.now();
  const id = loop.discordUserId;
  if (timeLeft <= 0) {
    void runExpiredLoopCleanupForUser(client, id);
    return;
  }
  const handle = setTimeout(() => {
    loopExpirationTimers.delete(id);
    void runExpiredLoopCleanupForUser(client, id);
  }, timeLeft);
  loopExpirationTimers.set(id, handle);
}

/**
 * Startup: load all open loops from storage and expire any past max duration (restart + pre-deploy safety).
 */
export async function cleanupExpiredLoopsOnStartup(client: Client): Promise<void> {
  const loops = await openLoopRepo.listAllOpenLoops(5000);
  for (const loop of loops) {
    if (!isLoopExpired(loop)) continue;
    await runExpiredLoopCleanupForUser(client, loop.discordUserId);
  }
}

/** @deprecated Use {@link cleanupExpiredLoopsOnStartup}. */
export const expireAllStaleOpenLoops = cleanupExpiredLoopsOnStartup;

export async function markActiveLoopAwaitingSnap(
  client: Client,
  openLoop: {
    discordUserId: string;
    guildId: string;
    commitmentText: string;
    openedAt: number;
    loopPanelChannelId?: string;
    loopPanelMessageId?: string;
  },
): Promise<void> {
  await openLoopRepo.setStatus(openLoop.discordUserId, 'awaiting_snap');
  if (!openLoop.loopPanelMessageId) return;
  const guild = await client.guilds.fetch(openLoop.guildId).catch(() => null);
  if (!guild) return;
  const targetChannelId = openLoop.loopPanelChannelId || getActiveLoopsChannelId();
  const channel = await guild.channels.fetch(targetChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  await channel.messages
    .fetch(openLoop.loopPanelMessageId)
    .then((msg) =>
      msg.edit({
        embeds: [
          buildActiveLoopPanelEmbed({
            taskText: openLoop.commitmentText,
            openedAt: openLoop.openedAt,
            status: 'awaiting_snap',
          }),
        ],
        components: buildActiveLoopPanelComponents(openLoop.discordUserId, 'awaiting_snap'),
      }),
    )
    .catch(() => {});
}

function isImageAttachment(att: { contentType: string | null; name: string | null }): boolean {
  if (att.contentType?.toLowerCase().startsWith('image/')) return true;
  if (!att.name) return false;
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(att.name);
}

export async function handleActiveLoopsProofMessage(message: Message): Promise<boolean> {
  executionLog.info('awaiting_snap_message_seen', {
    userId: message.author.id,
    channelId: message.channelId,
    attachments: message.attachments.size,
  });
  if (!message.inGuild() || message.author.bot) return false;
  if (message.guildId !== getExecutionPanelGuildId()) return false;
  if (message.channelId !== getActiveLoopsChannelId()) return false;

  const open = await loopService.getOpenLoopForUser(message.author.id);
  executionLog.info('awaiting_snap_session_lookup', {
    userId: message.author.id,
    found: Boolean(open),
    status: open?.status,
  });
  if (!open || open.status !== 'awaiting_snap') return false;

  if (isLoopExpired(open)) {
    await expireLoop(message.client, open);
    return false;
  }

  if (message.attachments.size < 1) return false;
  const firstAttachment = message.attachments.first();
  if (!firstAttachment) return false;

  let proofMember = message.member;
  if (!proofMember && message.guild) {
    proofMember = await message.guild.members.fetch(message.author.id).catch(() => null);
  }
  if (!hasLoopAccessMember(proofMember)) {
    await message.author.send(LOOP_ACCESS_GATE_MESSAGE).catch(() => {});
    return false;
  }

  const proofText = message.content.trim();
  const result = await loopService.closeLoop({
    discordUserId: message.author.id,
    proofText: proofText.length > 0 ? proofText : undefined,
    proofAttachmentUrls: [firstAttachment.url],
    proofMessageId: message.id,
  });
  if (!result.ok) {
    if (result.reason === 'expired') {
      await expireLoop(message.client, result.openLoop);
    }
    return false;
  }

  await sendExecutionCompleteToFeed(message.client, {
    userId: message.author.id,
    durationMs: result.closedLoop.openDurationMs,
    taskText: result.closedLoop.commitmentText,
    proofText: result.closedLoop.proofText,
    reflectionStatus: result.closedLoop.reflectionStatus,
    proofAttachmentUrls: result.closedLoop.proofAttachmentUrls,
  });
  const closeUsername = proofMember?.displayName ?? message.author.username;
  void logEvent(message.client, 'CLOSE', {
    userId: message.author.id,
    username: closeUsername,
    durationMs: result.closedLoop.openDurationMs,
  });
  cancelLoopExpirationTimer(message.author.id);
  await deleteActiveLoopPanelMessage(message.client, open);
  await ensureExecutionPanel(message.client, { source: 'proof_close', userId: message.author.id });
  await message.delete().catch((err) => {
    executionLog.warn('awaiting_snap_proof_message_delete_failed', {
      userId: message.author.id,
      channelId: message.channelId,
      messageId: message.id,
      reason: err instanceof Error ? err.message : String(err),
    });
  });
  return true;
}

type PanelLogExtra = Record<string, string | undefined>;

function panelContextKey(guildId: string, channelId: string): string {
  return `${guildId}:${channelId}`;
}

function panelRenderSignature(embed: EmbedBuilder): string {
  const json = embed.toJSON();
  return JSON.stringify({
    description: json.description ?? '',
    color: json.color ?? 0,
    fields: json.fields ?? [],
    footer: json.footer?.text ?? '',
  });
}

/**
 * Creates or refreshes the single control-panel message; dedupes older panel copies in-channel.
 */
export async function ensureExecutionPanel(client: Client, logExtra: PanelLogExtra = {}): Promise<EnsurePanelResult> {
  if (!isExecutionPanelConfigured()) {
    return { ok: false, reason: 'not_configured' };
  }

  const guildId = getExecutionPanelGuildId();
  const channelId = getExecutionPanelChannelId();
  const focusUserId =
    typeof logExtra.userId === 'string' && logExtra.userId.length > 0
      ? logExtra.userId
      : await panelStateRepo.getFocusUserId(guildId, channelId);
  if (typeof logExtra.userId === 'string' && logExtra.userId.length > 0) {
    await panelStateRepo.setFocusUserId(guildId, channelId, logExtra.userId);
  }
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    executionLog.error('execution_panel_bootstrap_failed', { guildId, channelId, reason: 'guild_fetch' });
    return { ok: false, reason: 'guild_fetch_failed' };
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    executionLog.error('execution_panel_bootstrap_failed', {
      guildId,
      channelId,
      reason: 'channel_not_text',
    });
    return { ok: false, reason: 'channel_not_text' };
  }

  const textChannel = channel as GuildTextBasedChannel;
  const embed = await buildPanelEmbed(client, guildId, channelId, focusUserId);
  const activeCount = (await openLoopRepo.listOpenLoopsInContext(guildId, channelId)).length;
  const components = buildPanelComponents(guildId, Math.max(0, activeCount - ACTIVE_VISIBLE_LIMIT));
  const clientId = client.user?.id;

  let panelMessage: Message | null = null;
  const storedId = await panelStateRepo.getPanelMessageId(guildId, channelId);

  if (storedId) {
    panelMessage = await textChannel.messages.fetch(storedId).catch(() => null);
  }

  if (!panelMessage) {
    const recent = await textChannel.messages.fetch({ limit: 100 });
    const ours = [...recent.values()].filter((m) => messageIsOurPanel(m, clientId));
    ours.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    if (ours.length > 0) {
      panelMessage = ours[0]!;
      for (let i = 1; i < ours.length; i++) {
        const dup = ours[i]!;
        await dup.delete().catch(() => {});
        executionLog.info('execution_panel_duplicate_pruned', {
          guildId,
          channelId,
          messageId: dup.id,
        });
      }
    }
  }

  try {
    if (panelMessage) {
      await panelMessage.edit({
        content: null,
        embeds: [embed],
        components,
        allowedMentions: {
          users: [],
        },
      });
      await panelStateRepo.setPanelMessageId(guildId, channelId, panelMessage.id);
      executionLog.info('execution_panel_restored', {
        guildId,
        channelId,
        panelMessageId: panelMessage.id,
        active_count: String(activeCount),
        ...logExtra,
      });
      executionLog.info('execution_panel_updated', {
        guildId,
        channelId,
        panelMessageId: panelMessage.id,
        active_count: String(activeCount),
        ...logExtra,
      });
      return {
        ok: true,
        action: 'updated',
        panelMessageId: panelMessage.id,
      };
    }

    const created = await textChannel.send({
      embeds: [embed],
      components,
      allowedMentions: {
        users: [],
      },
    });
    await panelStateRepo.setPanelMessageId(guildId, channelId, created.id);
    executionLog.info('execution_panel_created', {
      guildId,
      channelId,
      panelMessageId: created.id,
      active_count: String(activeCount),
      ...logExtra,
    });
    return {
      ok: true,
      action: 'created',
      panelMessageId: created.id,
    };
  } catch (err) {
    executionLog.error('execution_panel_bootstrap_failed', { guildId, channelId }, err);
    return { ok: false, reason: 'send_or_edit_failed' };
  }
}

/**
 * 15s ticker refresh for "live" elapsed times in ACTIVE.
 * - Runs only while at least one active loop exists.
 * - Skips message edits when rendered content did not change.
 */
export async function refreshExecutionPanelIfActive(client: Client): Promise<void> {
  if (!isExecutionPanelConfigured()) return;
  const guildId = getExecutionPanelGuildId();
  const channelId = getExecutionPanelChannelId();
  const contextKey = panelContextKey(guildId, channelId);

  try {
    let openLoops = await openLoopRepo.listOpenLoopsInContext(guildId, channelId, ACTIVE_FETCH_LIMIT);
    for (const loop of openLoops) {
      if (isLoopExpired(loop)) await runExpiredLoopCleanupForUser(client, loop.discordUserId);
    }
    openLoops = await openLoopRepo.listOpenLoopsInContext(guildId, channelId, ACTIVE_FETCH_LIMIT);
    if (openLoops.length < 1) {
      lastIntervalRenderByContext.delete(contextKey);
      return;
    }

    const focusUserId = await panelStateRepo.getFocusUserId(guildId, channelId);
    const embed = await buildPanelEmbed(client, guildId, channelId, focusUserId);
    const signature = panelRenderSignature(embed);
    if (lastIntervalRenderByContext.get(contextKey) === signature) return;

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    const textChannel = channel as GuildTextBasedChannel;

    const storedId = await panelStateRepo.getPanelMessageId(guildId, channelId);
    let panelMessage: Message | null = null;
    if (storedId) {
      panelMessage = await textChannel.messages.fetch(storedId).catch(() => null);
    }

    if (!panelMessage) {
      const restored = await ensureExecutionPanel(client, { source: 'interval_restore' });
      if (restored.ok) {
        lastIntervalRenderByContext.set(contextKey, signature);
      }
      return;
    }

    await panelMessage.edit({
      content: null,
      embeds: [embed],
      components: buildPanelComponents(guildId, Math.max(0, openLoops.length - ACTIVE_VISIBLE_LIMIT)),
      allowedMentions: {
        users: [],
      },
    });
    lastIntervalRenderByContext.set(contextKey, signature);
    executionLog.info('execution_panel_updated', {
      guildId,
      channelId,
      panelMessageId: panelMessage.id,
      active_count: String(openLoops.length),
      source: 'interval_tick',
      tick_ms: String(PANEL_TICK_INTERVAL_MS),
    });
  } catch (err) {
    executionLog.error('execution_panel_interval_refresh_failed', { guildId, channelId }, err);
  }
}

export function isExecutionPanelButtonCustomId(customId: string): boolean {
  return (
    customId === PANEL_BUTTON_OPEN ||
    customId === PANEL_BUTTON_TODAY ||
    customId === PANEL_BUTTON_ACTIVE_MORE ||
    customId.startsWith(LOOP_PANEL_BUTTON_CLOSE_PREFIX)
  );
}

export function isCitadelExecutionModalSubmit(customId: string): boolean {
  return customId === MODAL_START || customId === MODAL_END;
}

export async function handleExecutionModalSubmit(interaction: ModalSubmitInteraction): Promise<boolean> {
  if (!interaction.isModalSubmit()) return false;
  const customId = interaction.customId;
  if (!isCitadelExecutionModalSubmit(customId)) return false;

  const loc = modalPanelContextOrNull(interaction);
  if (!loc) {
    await interaction.reply({ content: 'Use this in the server.', ephemeral: true }).catch(() => {});
    return true;
  }

  const ctx = toExecutionAccessContext(interaction);
  const canUseExecution =
    customId === MODAL_END
      ? executionAccessService.isExecutionEnabledForGuild(ctx.guildId)
      : executionAccessService.canUseExecutionCommand(ctx);
  if (!canUseExecution) {
    await interaction.reply({ content: 'Execution is not available here.', ephemeral: true }).catch(() => {});
    return true;
  }

  if (!(await requireLoopAccess(interaction))) return true;

  const userId = interaction.user.id;
  const guildId = loc.guildId;
  const channelId = loc.channelId;

  if (customId === MODAL_START) {
    if (!isConfiguredPanelChannel(guildId, channelId)) {
      await interaction.reply({ content: 'Use the panel channel.', ephemeral: true }).catch(() => {});
      return true;
    }
    const commitmentRaw = interaction.fields.getTextInputValue(INPUT_COMMITMENT).trim();
    const commitment = commitmentRaw.replace(/\r?\n/g, ' ').trim();
    if (commitment.length < OPEN_INTENTION_MIN_LENGTH || isNonWorkIntention(commitment)) {
      await interaction.reply({ content: OPEN_INTENTION_INVALID_MESSAGE, ephemeral: true });
      return true;
    }

    executionLog.info('loop_open_requested', {
      userId,
      guildId,
      channelId,
      source: 'panel_modal',
    });

    await purgeExpiredLoopBeforeOpen(interaction.client, userId);

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (deferErr) {
      console.error('[citadel] MODAL_START deferReply failed', deferErr);
      executionLog.error('loop_open_defer_failed', { userId, guildId, channelId, source: 'panel_modal' }, deferErr);
      await interaction.reply({ content: 'Unable to open loop.', ephemeral: true }).catch(() => {});
      return true;
    }

    try {
      let existingOpen = await loopService.getOpenLoopForUser(userId);
      if (existingOpen && isLoopExpired(existingOpen)) {
        await runExpiredLoopCleanupForUser(interaction.client, userId);
        existingOpen = await loopService.getOpenLoopForUser(userId);
      }
      if (existingOpen) {
        const healedOpenLoop = await ensureActiveLoopPanelForOpenLoop(interaction.client, existingOpen);
        executionLog.info('loop_open_blocked_existing_open', {
          userId,
          guildId,
          channelId,
          loopId: healedOpenLoop.loopId,
          source: 'panel_modal',
        });
        await interaction.editReply({
          content: buildAlreadyOpenLoopReply(healedOpenLoop),
        });
        return true;
      }

      let result = await loopService.openLoop({
        discordUserId: userId,
        guildId,
        channelId,
        commitmentText: commitment.slice(0, 400),
      });

      if (!result.ok && isLoopExpired(result.openLoop)) {
        await runExpiredLoopCleanupForUser(interaction.client, userId);
        result = await loopService.openLoop({
          discordUserId: userId,
          guildId,
          channelId,
          commitmentText: commitment.slice(0, 400),
        });
      }

      if (!result.ok) {
        const healedOpenLoop = await ensureActiveLoopPanelForOpenLoop(interaction.client, result.openLoop);
        executionLog.info('loop_open_blocked_existing_open', {
          userId,
          guildId,
          channelId,
          loopId: healedOpenLoop.loopId,
          source: 'panel_modal',
        });
        await interaction.editReply({
          content: buildAlreadyOpenLoopReply(healedOpenLoop),
        });
        return true;
      }

      executionLog.info('loop_opened', {
        userId,
        guildId,
        channelId,
        loopId: result.openLoop.loopId,
        source: 'panel_modal',
      });

      await createActiveLoopPanelMessage(interaction.client, result.openLoop);
      await ensureExecutionPanel(interaction.client, { source: 'panel_open', userId });
      await interaction.editReply({ content: 'Loop started.' });
      const modalUsername = interaction.user.globalName ?? interaction.user.username;
      void logEvent(interaction.client, 'START', { userId, username: modalUsername });
    } catch (err) {
      console.error('[citadel] MODAL_START error', err);
      executionLog.error('loop_open_error', { userId, guildId, channelId, source: 'panel_modal' }, err);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: 'Unable to open loop.' });
        } else {
          await interaction.reply({ content: 'Unable to open loop.', ephemeral: true });
        }
      } catch (replyErr) {
        console.error('[citadel] MODAL_START failed to send error reply', replyErr);
      }
    }
    return true;
  }

  if (customId === MODAL_END) {
    await interaction
      .reply({
        content: 'Close modal is disabled. Click Close Loop, then upload one image in this channel.',
        ephemeral: true,
      })
      .catch(() => {});
    return true;
  }

  return false;
}

export async function handleExecutionPanelButton(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.isButton()) return false;
  const customId = interaction.customId;
  if (!isExecutionPanelButtonCustomId(customId)) return false;

  const loc = panelContextOrNull(interaction);
  if (!loc) {
    await interaction.reply({ content: 'Use this in the server.', ephemeral: true }).catch(() => {});
    return true;
  }

  const isMainPanelButton =
    customId === PANEL_BUTTON_OPEN || customId === PANEL_BUTTON_TODAY || customId === PANEL_BUTTON_ACTIVE_MORE;
  if (isMainPanelButton && !isConfiguredPanelChannel(loc.guildId, loc.channelId)) {
    await interaction.reply({ content: 'Use the panel channel.', ephemeral: true }).catch(() => {});
    return true;
  }
  if (
    customId.startsWith(LOOP_PANEL_BUTTON_CLOSE_PREFIX) &&
    !isConfiguredActiveLoopsChannel(loc.guildId, loc.channelId)
  ) {
    await interaction.reply({ content: 'Use the active-loops channel.', ephemeral: true }).catch(() => {});
    return true;
  }

  const ctx = toExecutionAccessContext(interaction);
  const canUseExecution = customId.startsWith(LOOP_PANEL_BUTTON_CLOSE_PREFIX)
    ? executionAccessService.isExecutionEnabledForGuild(ctx.guildId)
    : executionAccessService.canUseExecutionCommand(ctx);
  if (!canUseExecution) {
    await interaction.reply({ content: 'Execution is not available here.', ephemeral: true }).catch(() => {});
    return true;
  }

  if (!(await requireLoopAccess(interaction))) return true;

  if (customId === PANEL_BUTTON_OPEN) {
    await handleOpenButton(interaction);
    return true;
  }
  if (customId === PANEL_BUTTON_ACTIVE_MORE) {
    await handleActiveMoreButton(interaction);
    return true;
  }
  if (customId.startsWith(LOOP_PANEL_BUTTON_CLOSE_PREFIX)) {
    await handleOwnedLoopCloseButton(interaction, customId);
    return true;
  }
  if (customId === PANEL_BUTTON_TODAY) {
    await handleTodayButton(interaction);
    return true;
  }

  return false;
}

async function handleOpenButton(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const channelId = interaction.channelId!;

  await purgeExpiredLoopBeforeOpen(interaction.client, userId);

  const open = await loopService.getOpenLoopForUser(userId);
  if (open) {
    const healedOpenLoop = await ensureActiveLoopPanelForOpenLoop(interaction.client, open);
    executionLog.info('loop_open_blocked_existing_open', {
      userId,
      guildId,
      channelId,
      loopId: healedOpenLoop.loopId,
      source: 'panel',
    });
    await interaction.reply({
      content: buildAlreadyOpenLoopReply(healedOpenLoop),
      ephemeral: true,
    });
    return;
  }

  await interaction.showModal(buildStartModal());
}

async function handleOwnedLoopCloseButton(interaction: ButtonInteraction, customId: string): Promise<void> {
  const ownerUserId = ownerUserIdFromLoopPanelCloseCustomId(customId);
  if (!ownerUserId || interaction.user.id !== ownerUserId) {
    await interaction.reply({ content: 'This loop is not yours.', ephemeral: true });
    return;
  }
  const open = await loopService.getOpenLoopForUser(ownerUserId);
  if (!open) {
    await interaction.reply({ content: 'No open loop found.', ephemeral: true });
    return;
  }
  if (isLoopExpired(open)) {
    await expireLoop(interaction.client, open);
    await interaction.reply({ content: LOOP_EXPIRED_USER_MESSAGE, ephemeral: true });
    return;
  }
  if (open.status === 'awaiting_snap') {
    await interaction.reply({
      content: 'Awaiting snap. Upload one image in this channel to close.',
      ephemeral: true,
    });
    return;
  }
  await markActiveLoopAwaitingSnap(interaction.client, open);
  await interaction.reply({
    content: 'Snap proof to close the loop. Upload one image in this channel. Add text if you want.',
    ephemeral: true,
  });
}

async function handleTodayButton(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  try {
    executionLog.info('today_summary_requested', {
      userId: interaction.user.id,
      guildId: interaction.guildId!,
      channelId: interaction.channelId!,
      source: 'panel',
    });
    const content = await buildTodayClosedLoopsSummaryForContext({
      guildId: interaction.guildId!,
      channelId: interaction.channelId!,
      resolveDisplayName: async (discordUserId: string) => {
        const member = await interaction.guild?.members.fetch(discordUserId).catch(() => null);
        return member?.displayName ?? `<@${discordUserId}>`;
      },
    });
    await interaction.editReply({ content });
  } catch (err) {
    executionLog.error(
      'today_summary_error',
      {
        userId: interaction.user.id,
        guildId: interaction.guildId ?? undefined,
        channelId: interaction.channelId ?? undefined,
        source: 'panel',
      },
      err,
    );
    await interaction.editReply({ content: 'Something went wrong. Try again in a moment.' });
  }
}

async function handleActiveMoreButton(interaction: ButtonInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const channelId = interaction.channelId!;
  const openLoops = await openLoopRepo.listOpenLoopsInContext(guildId, channelId, ACTIVE_FETCH_LIMIT);
  const sorted = [...openLoops].sort((a, b) => a.openedAt - b.openedAt);
  const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);
  const lines = await Promise.all(
    sorted.map(async (loop) => {
      const member = guild ? await guild.members.fetch(loop.discordUserId).catch(() => null) : null;
      const name = member?.displayName ?? `<@${loop.discordUserId}>`;
      return `▸ ${name} — ${formatElapsedCompact(loop.openedAt)}`;
    }),
  );
  const content = lines.length > 0 ? ['ACTIVE LOOPS', '', ...lines].join('\n') : 'ACTIVE LOOPS\n\nNo active loops.';
  await interaction.reply({ content, ephemeral: true });
}
