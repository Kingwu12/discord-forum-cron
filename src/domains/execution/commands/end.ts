import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';

import { formatPublicSessionCompleteMessage } from '../formatters/session-summary-formatter';
import { executionAccessService, toExecutionAccessContext } from '../services/execution-access-service';
import { ExecutionSessionService } from '../services/execution-session-service';
import { START_REPLY_DENIED, START_REPLY_ERROR } from './start';

/** Ephemeral when there is nothing to end. */
export const END_REPLY_NO_ACTIVE_SESSION =
  'No active session. Use `/start` to begin.';

/** Ephemeral after a successful end (always sent once). */
export const END_REPLY_SUCCESS = 'Session ended.';

/**
 * Public line template (same as {@link formatPublicSessionCompleteMessage}):
 * `<@discordUserId> completed a {duration} execution session.`
 */
export const END_PUBLIC_SUMMARY_TEMPLATE =
  '<@discordUserId> completed a {duration} execution session.';

const executionSessionService = new ExecutionSessionService();

export const endSlashCommand = new SlashCommandBuilder()
  .setName('end')
  .setDescription('End your execution session');

export async function handleEndCommand(
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
    const result = await executionSessionService.endSession({
      discordUserId: interaction.user.id,
    });

    if (!result.ok) {
      await interaction.reply({
        content: END_REPLY_NO_ACTIVE_SESSION,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: END_REPLY_SUCCESS,
      ephemeral: true,
    });

    const allowPublic = executionAccessService.canPostPublicExecutionMessage(ctx);
    if (!allowPublic) return;

    const channel = interaction.channel;
    if (channel === null || !channel.isTextBased()) return;

    const publicContent = formatPublicSessionCompleteMessage({
      discordUserId: interaction.user.id,
      durationMs: result.completedSession.durationMs,
    });

    await channel.send({ content: publicContent });
  } catch {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: START_REPLY_ERROR,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: START_REPLY_ERROR,
        ephemeral: true,
      });
    }
  }
}
