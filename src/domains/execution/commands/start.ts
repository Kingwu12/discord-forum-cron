import {
  type ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';

import { ensureExecutionPanel } from '../../../bot/execution-panel';
import { executionLog } from '../../../shared/logging';
import { executionAccessService, toExecutionAccessContext } from '../services/execution-access-service';
import { LoopService } from '../services/loop-service';

/** User-facing copy (ephemeral — blocks only). */
export const START_REPLY_DENIED =
  'Execution commands are not available here.';
export const START_REPLY_ALREADY_OPEN =
  'You already have an open loop. Close it before opening another.';
export const START_REPLY_COMMITMENT_REQUIRED = 'Required.';
export const START_REPLY_ERROR =
  'Something went wrong. Try again in a moment.';

const loopService = new LoopService();
const START_EPHEMERAL_DELETE_DELAY_MS = 2500;

export const startSlashCommand = new SlashCommandBuilder()
  .setName('start')
  .setDescription('Open a loop')
  .addStringOption((option) =>
    option
      .setName('commitment')
      .setDescription('What will be executed (one line)')
      .setRequired(true)
      .setMaxLength(400),
  );

export async function handleStartCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (
    !interaction.inGuild() ||
    interaction.guildId === null ||
    interaction.channelId === null
  ) {
    executionLog.info('loop_open_blocked', {
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
    executionLog.info('loop_open_blocked', {
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

  const commitmentRaw = interaction.options.getString('commitment', true).trim();
  if (!commitmentRaw) {
    await interaction.reply({
      content: START_REPLY_COMMITMENT_REQUIRED,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  executionLog.info('loop_open_requested', {
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    source: 'slash',
  });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const result = await loopService.openLoop({
      discordUserId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      commitmentText: commitmentRaw,
    });

    if (!result.ok) {
      executionLog.info('loop_open_blocked_existing_open', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        loopId: result.openLoop.loopId,
      });
      await interaction.editReply({ content: START_REPLY_ALREADY_OPEN });
      return;
    }

    executionLog.info('loop_opened', {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      loopId: result.openLoop.loopId,
    });

    await ensureExecutionPanel(interaction.client, { source: 'slash_open', userId: interaction.user.id });
    await interaction.editReply({ content: '\u200b' });
    setTimeout(() => {
      void interaction.deleteReply().catch(() => {});
    }, START_EPHEMERAL_DELETE_DELAY_MS);
  } catch (err) {
    executionLog.error(
      'loop_open_error',
      {
        userId: interaction.user.id,
        guildId: interaction.guildId ?? undefined,
        channelId: interaction.channelId ?? undefined,
      },
      err,
    );
    await interaction.editReply({ content: START_REPLY_ERROR }).catch(() => {});
  }
}
