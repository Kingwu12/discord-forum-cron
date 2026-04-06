import type { ChatInputCommandInteraction } from 'discord.js';

import { handleEndCommand } from '../domains/execution/commands/end';
import { handleStartCommand } from '../domains/execution/commands/start';
import { handleTodayCommand } from '../domains/execution/commands/today';

import { handlePanelCommand } from './panel-command';

export async function routeChatInputCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  switch (interaction.commandName) {
    case 'start':
      await handleStartCommand(interaction);
      return;
    case 'end':
      await handleEndCommand(interaction);
      return;
    case 'today':
      await handleTodayCommand(interaction);
      return;
    case 'panel':
      await handlePanelCommand(interaction);
      return;
    default:
      await interaction.reply({
        content: 'Unknown command.',
        ephemeral: true,
      });
  }
}
