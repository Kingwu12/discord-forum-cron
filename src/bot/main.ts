import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';

import { routeChatInputCommand } from './command-router';

const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready — logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await routeChatInputCommand(interaction);
  } catch (err) {
    console.error(err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: 'Something went wrong.',
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: 'Something went wrong.',
          ephemeral: true,
        });
      }
    } catch {
      /* ignore */
    }
  }
});

client.login(token).catch((err) => {
  console.error(err);
  process.exit(1);
});
