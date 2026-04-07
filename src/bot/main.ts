/* Load env before any other project imports that may touch Firebase. */
import 'dotenv/config';

import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';

import { getExecutionPanelGuildId, getLoopAccessRoleId } from '../config/execution-panel-env';
import { routeChatInputCommand } from './command-router';
import {
  cleanupExpiredLoopsOnStartup,
  ensureExecutionPanel,
  handleActiveLoopsProofMessage,
  handleExecutionModalSubmit,
  handleExecutionPanelButton,
  refreshExecutionPanelIfActive,
  restoreOrphanedActiveLoopPanels,
} from './execution-panel';
import { logEvent, tickAnalyticsDayRollover } from '../shared/analytics/loop-behavior-analytics';

const token = process.env.DISCORD_BOT_TOKEN;
const PANEL_REFRESH_INTERVAL_MS = 15 * 1000;
const ANALYTICS_DAY_ROLLOVER_CHECK_MS = 60 * 60 * 1000;

if (!token) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Ready — logged in as ${readyClient.user.tag}`);
  await cleanupExpiredLoopsOnStartup(readyClient);
  const panelResult = await ensureExecutionPanel(readyClient, { source: 'startup' });
  if (!panelResult.ok) {
    console.warn(`Execution panel: ${panelResult.reason}`);
  }
  await restoreOrphanedActiveLoopPanels(readyClient);

  readyClient.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    if (newMember.guild.id !== getExecutionPanelGuildId()) return;
    const roleId = getLoopAccessRoleId();
    if (oldMember.roles.cache.has(roleId) || !newMember.roles.cache.has(roleId)) return;
    const username = newMember.displayName ?? newMember.user.username;
    void logEvent(newMember.client, 'ENTER', { userId: newMember.id, username });
  });

  setInterval(() => {
    tickAnalyticsDayRollover(readyClient);
  }, ANALYTICS_DAY_ROLLOVER_CHECK_MS).unref();

  let panelRefreshInFlight = false;
  setInterval(async () => {
    if (panelRefreshInFlight) return;
    panelRefreshInFlight = true;
    try {
      await refreshExecutionPanelIfActive(readyClient);
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

client.on(Events.MessageCreate, async (message) => {
  try {
    await handleActiveLoopsProofMessage(message);
  } catch (err) {
    console.error(err);
  }
});

client.login(token).catch((err) => {
  console.error(err);
  process.exit(1);
});
