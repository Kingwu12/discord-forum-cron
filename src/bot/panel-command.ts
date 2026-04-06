import {
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import {
  getExecutionPanelAdminUserIds,
  getExecutionPanelChannelId,
  getExecutionPanelGuildId,
} from '../config/execution-panel-env';
import { executionLog } from '../shared/logging';

import { ensureExecutionPanel } from './execution-panel';

export const panelSlashCommand = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('Execution panel (admin)')
  .addSubcommand((sub) =>
    sub.setName('deploy').setDescription('Create or refresh the execution panel in the target channel'),
  )
  .addSubcommand((sub) =>
    sub.setName('refresh').setDescription('Create or refresh the execution panel in the target channel'),
  );

function isPanelAdmin(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.inGuild() || interaction.guild === null) return false;
  const uid = interaction.user.id;
  if (interaction.guild.ownerId === uid) return true;
  if (getExecutionPanelAdminUserIds().has(uid)) return true;
  const perms = interaction.memberPermissions;
  if (perms?.has(PermissionFlagsBits.Administrator)) return true;
  return false;
}

export async function handlePanelCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'Use this command in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!isPanelAdmin(interaction)) {
    await interaction.reply({ content: 'Not allowed.', flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand(true);
  if (sub !== 'deploy' && sub !== 'refresh') {
    await interaction.reply({ content: 'Unknown subcommand.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const result = await ensureExecutionPanel(interaction.client, {
      userId: interaction.user.id,
      source: 'slash_panel',
    });
    if (result.ok) {
      await interaction.editReply({
        content: `Panel ${result.action === 'created' ? 'created' : 'updated'} (${result.panelMessageId}).`,
      });
    } else {
      executionLog.error('execution_panel_admin_failed', {
        userId: interaction.user.id,
        guildId: getExecutionPanelGuildId(),
        channelId: getExecutionPanelChannelId(),
        reason: result.reason,
      });
      await interaction.editReply({ content: `Panel failed: ${result.reason}` });
    }
  } catch (err) {
    executionLog.error(
      'execution_panel_admin_failed',
      {
        userId: interaction.user.id,
        guildId: getExecutionPanelGuildId(),
        channelId: getExecutionPanelChannelId(),
      },
      err,
    );
    await interaction.editReply({ content: 'Panel failed. Check logs.' });
  }
}
