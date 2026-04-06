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
  getExecutionPanelChannelId,
  getExecutionPanelGuildId,
  isExecutionPanelConfigured,
} from '../config/execution-panel-env';
import { ExecutionPanelStateRepo } from '../domains/execution/repositories/execution-panel-state-repo';
import { executionAccessService, toExecutionAccessContext } from '../domains/execution/services/execution-access-service';
import { LoopService } from '../domains/execution/services/loop-service';
import { buildTodayLoopsSummaryForUser } from '../domains/execution/services/today-loops-summary';
import { executionLog } from '../shared/logging';

import { sendExecutionCompleteToFeed } from './execution-feed-channel';

const loopService = new LoopService();
const panelStateRepo = new ExecutionPanelStateRepo();

export const PANEL_BUTTON_OPEN = 'citadel:exec:open';
export const PANEL_BUTTON_CLOSE = 'citadel:exec:close';
export const PANEL_BUTTON_TODAY = 'citadel:exec:today';
const MODAL_START = 'citadel:modal:start';
const MODAL_END = 'citadel:modal:end';
const INPUT_COMMITMENT = 'commitment';
const INPUT_PROOF = 'proof';
const INPUT_REFLECTION = 'reflection';

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

/** Restrained dark bar — reads as instrumentation, not marketing. */
const PANEL_EMBED_COLOR = 0x1e1f22;

function buildPanelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(PANEL_EMBED_COLOR)
    .setTitle('CITADEL')
    .setDescription('Online.')
    .addFields(
      { name: 'State', value: 'LIVE', inline: false },
      { name: 'Loop', value: 'No active loop', inline: false },
      { name: 'Protocol', value: 'Open → Execute → Close', inline: false },
    )
    .setFooter({ text: 'commit → execute → report → repeat' });
}

function buildPanelComponents(): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(PANEL_BUTTON_OPEN)
      .setLabel('Open Loop')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(PANEL_BUTTON_CLOSE)
      .setLabel('Close Loop')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(PANEL_BUTTON_TODAY)
      .setLabel('Today')
      .setStyle(ButtonStyle.Secondary),
  );
  return [row];
}

function displayNameFromModal(interaction: ModalSubmitInteraction): string {
  const m = interaction.member;
  if (
    m &&
    typeof m === 'object' &&
    'displayName' in m &&
    typeof (m as { displayName: string }).displayName === 'string'
  ) {
    return (m as { displayName: string }).displayName;
  }
  return interaction.user.username;
}

function buildStartModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(MODAL_START)
    .setTitle('CITADEL · OPEN LOOP')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(INPUT_COMMITMENT)
          .setLabel('What will be executed?')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(400)
          .setRequired(true),
      ),
    );
}

function buildEndModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(MODAL_END)
    .setTitle('CITADEL · CLOSE LOOP')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(INPUT_PROOF)
          .setLabel('What was executed?')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(2000)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(INPUT_REFLECTION)
          .setLabel('Proof (optional)')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(false),
      ),
    );
}

type PanelLogExtra = Record<string, string | undefined>;

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
  const embed = buildPanelEmbed();
  const components = buildPanelComponents();
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
      await panelMessage.edit({ content: null, embeds: [embed], components });
      await panelStateRepo.setPanelMessageId(guildId, channelId, panelMessage.id);
      executionLog.info('execution_panel_restored', {
        guildId,
        channelId,
        panelMessageId: panelMessage.id,
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

export function isExecutionPanelButtonCustomId(customId: string): boolean {
  return (
    customId === PANEL_BUTTON_OPEN ||
    customId === PANEL_BUTTON_CLOSE ||
    customId === PANEL_BUTTON_TODAY
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

  if (!isConfiguredPanelChannel(loc.guildId, loc.channelId)) {
    await interaction
      .reply({ content: 'Use the panel channel.', ephemeral: true })
      .catch(() => {});
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
    const commitmentRaw = interaction.fields.getTextInputValue(INPUT_COMMITMENT).trim();
    const commitment = commitmentRaw.replace(/\r?\n/g, ' ').trim();
    if (!commitment) {
      await interaction.reply({ content: 'Required.', ephemeral: true });
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

      await interaction.editReply({ content: 'Loop open.' });
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
    const proof = interaction.fields.getTextInputValue(INPUT_PROOF).trim();
    const reflectionNotesRaw = interaction.fields.getTextInputValue(INPUT_REFLECTION)?.trim() ?? '';

    if (!proof) {
      executionLog.info('loop_close_blocked_no_proof', {
        userId,
        guildId,
        channelId,
        source: 'panel_modal',
      });
      await interaction.reply({ content: 'Required.', ephemeral: true });
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

      await sendExecutionCompleteToFeed(interaction.client, {
        userId,
        durationMs: result.closedLoop.openDurationMs,
        taskText: result.closedLoop.commitmentText,
        completionText: proof,
        reflectionStatus: result.closedLoop.reflectionStatus,
        reflectionNotes: result.closedLoop.reflectionNotes,
      });

      await interaction.editReply({ content: 'Loop closed.' });
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

  if (!isConfiguredPanelChannel(loc.guildId, loc.channelId)) {
    await interaction
      .reply({ content: 'Use the panel channel.', ephemeral: true })
      .catch(() => {});
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
  if (customId === PANEL_BUTTON_CLOSE) {
    await handleCloseButton(interaction);
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

async function handleCloseButton(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const channelId = interaction.channelId!;

  const open = await loopService.getOpenLoopForUser(userId);
  if (!open) {
    executionLog.info('loop_close_blocked_no_open', {
      userId,
      guildId,
      channelId,
      source: 'panel',
    });
    await interaction.reply({
      content: 'No open loop found.',
      ephemeral: true,
    });
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
    const content = await buildTodayLoopsSummaryForUser(interaction.user.id);
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

