/* Load env before any other project imports that may touch Firebase. */
import 'dotenv/config';

import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';

import { routeChatInputCommand } from './command-router';
import {
  ensureExecutionPanel,
  handleExecutionModalSubmit,
  handleExecutionPanelButton,
} from './execution-panel';

const token = process.env.DISCORD_BOT_TOKEN;
const PANEL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

if (!token) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Ready — logged in as ${readyClient.user.tag}`);
  const panelResult = await ensureExecutionPanel(readyClient, { source: 'startup' });
  if (!panelResult.ok) {
    console.warn(`Execution panel: ${panelResult.reason}`);
  }

  let panelRefreshInFlight = false;
  setInterval(async () => {
    if (panelRefreshInFlight) return;
    panelRefreshInFlight = true;
    try {
      const refreshResult = await ensureExecutionPanel(readyClient, { source: 'interval' });
      if (!refreshResult.ok) {
        console.warn(`Execution panel refresh: ${refreshResult.reason}`);
      }
    } finally {
      panelRefreshInFlight = false;
    }
  }, PANEL_REFRESH_INTERVAL_MS).unref();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isModalSubmit()) {
      const handled = await handleExecutionModalSubmit(interaction);
      if (handled) return;
    }
    if (interaction.isButton()) {
      const handled = await handleExecutionPanelButton(interaction);
      if (handled) return;
    }
    if (!interaction.isChatInputCommand()) return;
    await routeChatInputCommand(interaction);
  } catch (err) {
    console.error(err);
    try {
      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({
            content: 'Something went wrong.',
            flags: MessageFlags.Ephemeral,
          });
        } else {
          await interaction.reply({
            content: 'Something went wrong.',
            flags: MessageFlags.Ephemeral,
          });
        }
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
