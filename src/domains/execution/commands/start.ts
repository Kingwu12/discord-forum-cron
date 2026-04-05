import {
  type ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';

import { executionLog } from '../../../shared/logging';
import { executionAccessService, toExecutionAccessContext } from '../services/execution-access-service';
import { ExecutionSessionService } from '../services/execution-session-service';

/** User-facing copy (ephemeral replies). */
export const START_REPLY_DENIED =
  'Execution commands are not available here.';
export const START_REPLY_ALREADY_ACTIVE =
  'You already have an active session. Use `/end` when you are finished.';
export const START_REPLY_SUCCESS = 'Session started.';
export const START_REPLY_ERROR =
  'Something went wrong. Try again in a moment.';

const executionSessionService = new ExecutionSessionService();

export const startSlashCommand = new SlashCommandBuilder()
  .setName('start')
  .setDescription('Begin an execution session');

export async function handleStartCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (
    !interaction.inGuild() ||
    interaction.guildId === null ||
    interaction.channelId === null
  ) {
    executionLog.info('start_blocked', {
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
    executionLog.info('start_blocked', {
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

  executionLog.info('start_attempt', {
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
  });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const result = await executionSessionService.startSession({
      discordUserId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
    });

    if (!result.ok) {
      executionLog.info('start_blocked', {
        reason: 'already_active',
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      });
      await interaction.editReply({ content: START_REPLY_ALREADY_ACTIVE });
      return;
    }

    executionLog.info('start_success', {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
    });
    await interaction.editReply({ content: START_REPLY_SUCCESS });
  } catch (err) {
    executionLog.error(
      'start_error',
      {
        userId: interaction.user.id,
        guildId: interaction.guildId ?? undefined,
        channelId: interaction.channelId ?? undefined,
      },
      err,
    );
    await interaction.editReply({ content: START_REPLY_ERROR });
  }
}
