import { type ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';

import {
  createActiveLoopPanelMessage,
  ensureActiveLoopPanelForOpenLoop,
  ensureExecutionPanel,
  purgeExpiredLoopBeforeOpen,
  runExpiredLoopCleanupForUser,
} from '../../../bot/execution-panel';
import { isLoopExpired } from '../constants/loop-expiration';
import { buildAlreadyOpenLoopReply } from '../formatters/open-loop-link';
import { executionLog } from '../../../shared/logging';
import { executionAccessService, toExecutionAccessContext } from '../services/execution-access-service';
import { requireLoopAccess } from '../services/loop-access-guard';
import { LoopService } from '../services/loop-service';
import { logEvent } from '../../../shared/analytics/loop-behavior-analytics';

/** User-facing copy (ephemeral — blocks only). */
export const START_REPLY_DENIED = 'Execution commands are not available here.';
export const START_REPLY_ALREADY_OPEN = 'You already have an open loop. Close it before opening another.';
export const START_REPLY_COMMITMENT_REQUIRED = 'Required.';
export const START_REPLY_ERROR = 'Something went wrong. Try again in a moment.';

const loopService = new LoopService();

export const startSlashCommand = new SlashCommandBuilder()
  .setName('start')
  .setDescription('Open a loop')
  .addStringOption((option) =>
    option.setName('commitment').setDescription('What will be executed (one line)').setRequired(true).setMaxLength(400),
  );

export async function handleStartCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || interaction.guildId === null || interaction.channelId === null) {
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

  if (!(await requireLoopAccess(interaction))) {
    executionLog.info('loop_open_blocked', {
      reason: 'loop_access_role',
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
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
    await purgeExpiredLoopBeforeOpen(interaction.client, interaction.user.id);

    let result = await loopService.openLoop({
      discordUserId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      commitmentText: commitmentRaw,
    });

    if (!result.ok && isLoopExpired(result.openLoop)) {
      await runExpiredLoopCleanupForUser(interaction.client, interaction.user.id);
      result = await loopService.openLoop({
        discordUserId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        commitmentText: commitmentRaw,
      });
    }

    if (!result.ok) {
      const healedOpenLoop = await ensureActiveLoopPanelForOpenLoop(interaction.client, result.openLoop);
      executionLog.info('loop_open_blocked_existing_open', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        loopId: healedOpenLoop.loopId,
      });
      await interaction.editReply({ content: buildAlreadyOpenLoopReply(healedOpenLoop) });
      return;
    }

    executionLog.info('loop_opened', {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      loopId: result.openLoop.loopId,
    });

    await createActiveLoopPanelMessage(interaction.client, result.openLoop);
    await ensureExecutionPanel(interaction.client, { source: 'slash_open', userId: interaction.user.id });
    await interaction.editReply({ content: 'Loop started.' });
    const slashUsername =
      interaction.member &&
      typeof interaction.member === 'object' &&
      'displayName' in interaction.member &&
      typeof (interaction.member as { displayName: string }).displayName === 'string'
        ? (interaction.member as { displayName: string }).displayName
        : interaction.user.globalName ?? interaction.user.username;
    void logEvent(interaction.client, 'START', {
      userId: interaction.user.id,
      username: slashUsername,
    });
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
