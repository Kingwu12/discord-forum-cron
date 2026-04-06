import {
  type ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';

import { ensureExecutionPanel } from '../../../bot/execution-panel';
import { getExecutionFeedChannelId } from '../../../config/execution-panel-env';
import { buildSuggestedClosePost } from '../formatters/execution-feed-formatter';
import { executionLog } from '../../../shared/logging';
import { executionAccessService, toExecutionAccessContext } from '../services/execution-access-service';
import type { ReflectionStatus } from '../types/execution.types';
import { LoopService } from '../services/loop-service';
import { START_REPLY_DENIED, START_REPLY_ERROR } from './start';

export const END_REPLY_NO_OPEN_LOOP = 'No open loop found.';
export const END_REPLY_PROOF_REQUIRED = 'Required.';

const loopService = new LoopService();

const REFLECTION_VALUES = new Set<ReflectionStatus>(['moved', 'partial', 'stalled']);

export const endSlashCommand = new SlashCommandBuilder()
  .setName('end')
  .setDescription('Close the active loop')
  .addStringOption((option) =>
    option
      .setName('reflection')
      .setDescription('Closure state')
      .setRequired(true)
      .addChoices(
        { name: 'moved', value: 'moved' },
        { name: 'partial', value: 'partial' },
        { name: 'stalled', value: 'stalled' },
      ),
  )
  .addStringOption((option) =>
    option
      .setName('proof_text')
      .setDescription('What was executed (text or link)')
      .setRequired(false)
      .setMaxLength(2000),
  )
  .addAttachmentOption((option) =>
    option
      .setName('proof_file')
      .setDescription('Proof attachment')
      .setRequired(false),
  );

export async function handleEndCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (
    !interaction.inGuild() ||
    interaction.guildId === null ||
    interaction.channelId === null
  ) {
    executionLog.info('loop_close_blocked', {
      reason: 'invalid_context',
      userId: interaction.user.id,
    });
    await interaction.reply({
      content: START_REPLY_DENIED,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const ctx = toExecutionAccessContext(interaction);
  if (!executionAccessService.canUseExecutionCommand(ctx)) {
    executionLog.info('loop_close_blocked', {
      reason: 'execution_not_allowed',
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
    });
    await interaction.reply({
      content: START_REPLY_DENIED,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const open = await loopService.getOpenLoopForUser(interaction.user.id);
  if (!open) {
    executionLog.info('loop_close_blocked_no_open', {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
    });
    await interaction.reply({
      content: END_REPLY_NO_OPEN_LOOP,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const proofFile = interaction.options.getAttachment('proof_file');
  const proofText = interaction.options.getString('proof_text')?.trim() ?? '';
  const hasProof = Boolean(proofFile) || proofText.length > 0;

  if (!hasProof) {
    executionLog.info('loop_close_blocked_no_proof', {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      loopId: open.loopId,
    });
    await interaction.reply({
      content: END_REPLY_PROOF_REQUIRED,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const reflectionRaw = interaction.options.getString('reflection', true) as ReflectionStatus;
  if (!REFLECTION_VALUES.has(reflectionRaw)) {
    await interaction.reply({
      content: START_REPLY_ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const proofAttachmentUrls = proofFile ? [proofFile.url] : undefined;

  executionLog.info('loop_close_requested', {
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    loopId: open.loopId,
    source: 'slash',
  });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const result = await loopService.closeLoop({
      discordUserId: interaction.user.id,
      proofText: proofText.length > 0 ? proofText : undefined,
      proofAttachmentUrls,
      reflectionStatus: reflectionRaw,
    });

    if (!result.ok) {
      executionLog.info('loop_close_blocked_no_open', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      });
      await interaction.editReply({ content: END_REPLY_NO_OPEN_LOOP });
      return;
    }

    executionLog.info('loop_closed', {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      loopId: result.closedLoop.loopId,
      openDurationMs: result.closedLoop.openDurationMs,
      closedLoopFirestoreId: result.closedLoopFirestoreId,
    });

    await ensureExecutionPanel(interaction.client, { source: 'slash_close', userId: interaction.user.id });
    const suggestedPost = buildSuggestedClosePost({
      durationMs: result.closedLoop.openDurationMs,
      executedText: result.closedLoop.commitmentText,
      proofText: result.closedLoop.proofText,
      reflectionStatus: result.closedLoop.reflectionStatus,
    });
    const hasAttachmentProof = (result.closedLoop.proofAttachmentUrls?.length ?? 0) > 0;
    await interaction.editReply({
      content: [
        `Loop closed. Post it in <#${getExecutionFeedChannelId()}>.`,
        '',
        '```',
        suggestedPost,
        '```',
        hasAttachmentProof ? 'Include your attachment in that post.' : '',
      ].filter(Boolean).join('\n'),
    });
  } catch (err) {
    executionLog.error(
      'loop_close_error',
      {
        userId: interaction.user.id,
        guildId: interaction.guildId ?? undefined,
        channelId: interaction.channelId ?? undefined,
        loopId: open.loopId,
      },
      err,
    );
    await interaction.editReply({ content: START_REPLY_ERROR }).catch(() => {});
  }
}
