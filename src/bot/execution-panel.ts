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
import { sendExecutionCompleteToFeed } from './execution-feed-channel';
import { ClosedLoopRepo } from '../domains/execution/repositories/closed-loop-repo';
import { ExecutionPanelStateRepo } from '../domains/execution/repositories/execution-panel-state-repo';
import { OpenLoopRepo } from '../domains/execution/repositories/open-loop-repo';
import { buildLoopOpenCockpitEmbed, formatElapsedCompact } from '../domains/execution/formatters/loop-cockpit-embed';
import { sanitizeCommitmentDisplay } from '../domains/execution/formatters/loop-formatters';
import { executionAccessService, toExecutionAccessContext } from '../domains/execution/services/execution-access-service';
import { LoopService } from '../domains/execution/services/loop-service';
import { buildTodayClosedLoopsSummaryForContext } from '../domains/execution/services/today-loops-summary';
import { executionLog } from '../shared/logging';

const loopService = new LoopService();
const panelStateRepo = new ExecutionPanelStateRepo();
const openLoopRepo = new OpenLoopRepo();
const closedLoopRepo = new ClosedLoopRepo();

export const PANEL_BUTTON_OPEN = 'citadel:exec:open';
export const PANEL_BUTTON_TODAY = 'citadel:exec:today';
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
    o.code === 9 ||
    o.code === '9' ||
    (message.includes('failed_precondition') && message.includes('requires an index'))
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
  const openLoops = await openLoopRepo.listOpenLoopsInContext(guildId, channelId, ACTIVE_FETCH_LIMIT);
  const sortedOpenLoops = [...openLoops].sort((a, b) => a.openedAt - b.openedAt);
  const activeCount = sortedOpenLoops.length;
  const shown = sortedOpenLoops.slice(0, ACTIVE_VISIBLE_LIMIT);
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const activeEntries = await Promise.all(
    shown.map(async (loop) => {
      const member = guild ? await guild.members.fetch(loop.discordUserId).catch(() => null) : null;
      const name = member?.displayName ?? `<@${loop.discordUserId}>`;
      const intention = sanitizeCommitmentDisplay(loop.commitmentText, 80) || '—';
      return `▸ ${name} — ${intention} · ${formatElapsedCompact(loop.openedAt)}`;
    }),
  );
  const remainder = Math.max(0, activeCount - activeEntries.length);
  const activeValue = activeEntries.length > 0
    ? [...activeEntries, remainder > 0 ? `+${remainder} more` : '']
      .filter(Boolean)
      .join('\n')
    : 'No active loops.';
  let todayValue = '— loops closed';
  try {
    const todayRange = closedLoopRepo.todayRange();
    const closedToday = await closedLoopRepo.listClosedInContextByClosedAtRange(
      guildId,
      channelId,
      todayRange,
    );
    todayValue = `${closedToday.length} loops closed`;
  } catch (err) {
    if (isFirestoreMissingIndexError(err)) {
      executionLog.warn('execution_panel_today_count_unavailable_missing_index', {
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
      { name: '◈ TODAY', value: todayValue, inline: true },
    )
    .setFooter({ text: `MODE LABS · updated at ${formatPanelClock(now)}` });
}

function buildPanelComponents(): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(PANEL_BUTTON_OPEN)
      .setLabel('Open Loop')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(PANEL_BUTTON_TODAY)
      .setLabel('Today')
      .setStyle(ButtonStyle.Secondary),
  );
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
          .setRequired(true),
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

function buildActiveLoopPanelEmbed(taskText: string, openedAt: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xffd700)
    .setDescription('● LOOP OPEN')
    .addFields(
      { name: '◈ EXECUTING', value: sanitizeCommitmentDisplay(taskText, 500) || '—', inline: false },
      { name: '◈ TIME IN', value: formatElapsedCompact(openedAt), inline: false },
      { name: '◈ STATUS', value: 'LIVE', inline: false },
    );
}

function buildActiveLoopPanelComponents(ownerUserId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildLoopPanelCloseCustomId(ownerUserId))
        .setLabel('Close Loop')
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
  const msg = await channel.send({
    embeds: [buildActiveLoopPanelEmbed(openLoop.commitmentText, openLoop.openedAt)],
    components: buildActiveLoopPanelComponents(openLoop.discordUserId),
  });
  await openLoopRepo.setLoopPanelRef(openLoop.discordUserId, msg.id, channel.id);
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
  await channel.messages.fetch(openLoop.loopPanelMessageId).then((m) => m.delete()).catch(() => {});
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
export async function ensureExecutionPanel(
  client: Client,
  logExtra: PanelLogExtra = {},
): Promise<EnsurePanelResult> {
  if (!isExecutionPanelConfigured()) {
    return { ok: false, reason: 'not_configured' };
  }

  const guildId = getExecutionPanelGuildId();
  const channelId = getExecutionPanelChannelId();
  const focusUserId = typeof logExtra.userId === 'string' && logExtra.userId.length > 0
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
  const components = buildPanelComponents();
  const clientId = client.user?.id;
  const activeCount = (await openLoopRepo.listOpenLoopsInContext(guildId, channelId)).length;

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
      await panelMessage.edit({ content: null, embeds: [embed], components });
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

    const created = await textChannel.send({ embeds: [embed], components });
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
    const openLoops = await openLoopRepo.listOpenLoopsInContext(guildId, channelId, ACTIVE_FETCH_LIMIT);
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

    await panelMessage.edit({ content: null, embeds: [embed], components: buildPanelComponents() });
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
  if (!executionAccessService.canUseExecutionCommand(ctx)) {
    await interaction.reply({ content: 'Execution is not available here.', ephemeral: true }).catch(() => {});
    return true;
  }

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

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (deferErr) {
      console.error('[citadel] MODAL_START deferReply failed', deferErr);
      executionLog.error(
        'loop_open_defer_failed',
        { userId, guildId, channelId, source: 'panel_modal' },
        deferErr,
      );
      await interaction
        .reply({ content: 'Unable to open loop.', ephemeral: true })
        .catch(() => {});
      return true;
    }

    try {
      const existingOpen = await loopService.getOpenLoopForUser(userId);
      if (existingOpen) {
        executionLog.info('loop_open_blocked_existing_open', {
          userId,
          guildId,
          channelId,
          loopId: existingOpen.loopId,
          source: 'panel_modal',
        });
        await interaction.editReply({
          content: 'You already have an open loop. Close it before opening another.',
        });
        return true;
      }

      const result = await loopService.openLoop({
        discordUserId: userId,
        guildId,
        channelId,
        commitmentText: commitment.slice(0, 400),
      });

      if (!result.ok) {
        executionLog.info('loop_open_blocked_existing_open', {
          userId,
          guildId,
          channelId,
          loopId: result.openLoop.loopId,
          source: 'panel_modal',
        });
        await interaction.editReply({
          content: 'You already have an open loop. Close it before opening another.',
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
      await interaction.editReply({
        embeds: [
          buildLoopOpenCockpitEmbed({
            intention: result.openLoop.commitmentText,
            openedAt: result.openLoop.openedAt,
          }),
        ],
      });
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
    if (!isConfiguredActiveLoopsChannel(guildId, channelId)) {
      await interaction.reply({ content: 'Use the active-loops channel.', ephemeral: true }).catch(() => {});
      return true;
    }
    const proof = interaction.fields.getTextInputValue(INPUT_PROOF).trim();
    const reflectionNotesRaw = interaction.fields.getTextInputValue(INPUT_REFLECTION)?.trim() ?? '';
    // Future enhancement: after modal submit, prompt user for attachment upload
    // as a second-step proof flow (Discord modals do not support file uploads).

    if (!proof) {
      executionLog.info('loop_close_blocked_no_proof', {
        userId,
        guildId,
        channelId,
        source: 'panel_modal',
      });
      await interaction.reply({ content: CLOSE_PROOF_REQUIRED_MESSAGE, ephemeral: true });
      return true;
    }
    if (!reflectionNotesRaw) {
      executionLog.info('loop_close_blocked_no_proof', {
        userId,
        guildId,
        channelId,
        source: 'panel_modal',
      });
      await interaction.reply({ content: CLOSE_PROOF_REQUIRED_MESSAGE, ephemeral: true });
      return true;
    }

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (deferErr) {
      console.error('[citadel] MODAL_END deferReply failed', deferErr);
      executionLog.error(
        'loop_close_defer_failed',
        { userId, guildId, channelId, source: 'panel_modal' },
        deferErr,
      );
      await interaction
        .reply({ content: 'Unable to close loop.', ephemeral: true })
        .catch(() => {});
      return true;
    }

    try {
      const open = await loopService.getOpenLoopForUser(userId);
      if (!open) {
        executionLog.info('loop_close_blocked_no_open', {
          userId,
          guildId,
          channelId,
          source: 'panel_modal',
        });
        await interaction.editReply({ content: 'No open loop found.' });
        return true;
      }

      executionLog.info('loop_close_requested', {
        userId,
        guildId,
        channelId,
        loopId: open.loopId,
        source: 'panel_modal',
      });

      executionLog.info('loop_proof_received', {
        userId,
        guildId,
        channelId,
        loopId: open.loopId,
        source: 'panel_modal',
      });

      const result = await loopService.closeLoop({
        discordUserId: userId,
        proofText: proof,
        reflectionStatus: 'partial',
        reflectionNotes: reflectionNotesRaw.length > 0 ? reflectionNotesRaw : undefined,
      });

      if (!result.ok) {
        executionLog.info('loop_close_blocked_no_open', {
          userId,
          guildId,
          channelId,
          source: 'panel_modal',
        });
        await interaction.editReply({ content: 'No open loop found.' });
        return true;
      }

      executionLog.info('loop_closed', {
        userId,
        guildId,
        channelId,
        loopId: result.closedLoop.loopId,
        openDurationMs: result.closedLoop.openDurationMs,
        closedLoopFirestoreId: result.closedLoopFirestoreId,
        source: 'panel_modal',
      });

      await deleteActiveLoopPanelMessage(interaction.client, open);
      await ensureExecutionPanel(interaction.client, { source: 'panel_close', userId });
      await sendExecutionCompleteToFeed(interaction.client, {
        userId,
        durationMs: result.closedLoop.openDurationMs,
        taskText: result.closedLoop.commitmentText,
        proofText: result.closedLoop.proofText,
        reflectionStatus: result.closedLoop.reflectionStatus,
        proofAttachmentUrls: result.closedLoop.proofAttachmentUrls,
      });
      await interaction.deleteReply().catch(() => {});
    } catch (err) {
      console.error('[citadel] MODAL_END error', err);
      executionLog.error(
        'loop_close_error',
        { userId, guildId, channelId, source: 'panel_modal' },
        err,
      );
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: 'Unable to close loop.' });
        } else {
          await interaction.reply({ content: 'Unable to close loop.', ephemeral: true });
        }
      } catch (replyErr) {
        console.error('[citadel] MODAL_END failed to send error reply', replyErr);
      }
    }
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

  const isMainPanelButton = customId === PANEL_BUTTON_OPEN || customId === PANEL_BUTTON_TODAY;
  if (isMainPanelButton && !isConfiguredPanelChannel(loc.guildId, loc.channelId)) {
    await interaction
      .reply({ content: 'Use the panel channel.', ephemeral: true })
      .catch(() => {});
    return true;
  }
  if (customId.startsWith(LOOP_PANEL_BUTTON_CLOSE_PREFIX) && !isConfiguredActiveLoopsChannel(loc.guildId, loc.channelId)) {
    await interaction.reply({ content: 'Use the active-loops channel.', ephemeral: true }).catch(() => {});
    return true;
  }

  const ctx = toExecutionAccessContext(interaction);
  if (!executionAccessService.canUseExecutionCommand(ctx)) {
    await interaction.reply({ content: 'Execution is not available here.', ephemeral: true }).catch(() => {});
    return true;
  }

  if (customId === PANEL_BUTTON_OPEN) {
    await handleOpenButton(interaction);
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

  const open = await loopService.getOpenLoopForUser(userId);
  if (open) {
    executionLog.info('loop_open_blocked_existing_open', {
      userId,
      guildId,
      channelId,
      loopId: open.loopId,
      source: 'panel',
    });
    await interaction.reply({
      content: 'You already have an open loop. Close it before opening another.',
      ephemeral: true,
    });
    return;
  }

  await interaction.showModal(buildStartModal());
}

async function handleOwnedLoopCloseButton(
  interaction: ButtonInteraction,
  customId: string,
): Promise<void> {
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
  await interaction.showModal(buildEndModal());
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

