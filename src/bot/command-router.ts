import type { ChatInputCommandInteraction } from 'discord.js';

import { handleStartCommand } from '../domains/execution/commands/start';

export async function routeChatInputCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  switch (interaction.commandName) {
    case 'start':
      await handleStartCommand(interaction);
      return;
    default:
      await interaction.reply({
        content: 'Unknown command.',
        ephemeral: true,
      });
  }
}
