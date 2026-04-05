import {
  type ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';

import { executionLog } from '../../../shared/logging';
import { formatPublicSessionCompleteMessage } from '../formatters/session-summary-formatter';
import { executionAccessService, toExecutionAccessContext } from '../services/execution-access-service';
import { ExecutionSessionService } from '../services/execution-session-service';
import { START_REPLY_DENIED, START_REPLY_ERROR } from './start';

/** Ephemeral when the user has no active session to end. */
export const END_REPLY_NO_ACTIVE_SESSION = 'You do not have an active session.';

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
    executionLog.info('end_blocked', {
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
    executionLog.info('end_blocked', {
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

  executionLog.info('end_attempt', {
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
  });

  try {
    const active = await executionSessionService.getActiveSessionForUser(interaction.user.id);
    if (!active) {
      executionLog.info('end_blocked', {
        reason: 'no_active_session',
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      });
      await interaction.reply({
        content: END_REPLY_NO_ACTIVE_SESSION,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Public defer — success path must not use ephemeral (no "Only you can see this").
    await interaction.deferReply();

    const result = await executionSessionService.endSession({
      discordUserId: interaction.user.id,
    });

    if (!result.ok) {
      executionLog.info('end_blocked', {
        reason: 'no_active_session',
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      });
      await interaction.deleteReply().catch(() => {});
      await interaction.followUp({
        content: END_REPLY_NO_ACTIVE_SESSION,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    executionLog.info('end_success', {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      completedSessionId: result.completedSessionId,
    });

    const publicContent = formatPublicSessionCompleteMessage({
      discordUserId: interaction.user.id,
      durationMs: result.completedSession.durationMs,
    });

    await interaction.editReply({ content: publicContent });
  } catch (err) {
    executionLog.error(
      'end_error',
      {
        userId: interaction.user.id,
        guildId: interaction.guildId ?? undefined,
        channelId: interaction.channelId ?? undefined,
      },
      err,
    );
    try {
      if (interaction.deferred) {
        await interaction.deleteReply().catch(() => {});
        await interaction.followUp({
          content: START_REPLY_ERROR,
          flags: MessageFlags.Ephemeral,
        });
      } else if (interaction.replied) {
        await interaction.followUp({
          content: START_REPLY_ERROR,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: START_REPLY_ERROR,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch {
      /* ignore */
    }
  }
}
