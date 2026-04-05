import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';

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
    await interaction.reply({
      content: START_REPLY_DENIED,
      ephemeral: true,
    });
    return;
  }

  const ctx = toExecutionAccessContext(interaction);
  if (!executionAccessService.canUseExecutionCommand(ctx)) {
    await interaction.reply({
      content: START_REPLY_DENIED,
      ephemeral: true,
    });
    return;
  }

  try {
    const result = await executionSessionService.startSession({
      discordUserId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
    });

    if (!result.ok) {
      await interaction.reply({
        content: START_REPLY_ALREADY_ACTIVE,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: START_REPLY_SUCCESS,
      ephemeral: true,
    });
  } catch {
    await interaction.reply({
      content: START_REPLY_ERROR,
      ephemeral: true,
    });
  }
}
