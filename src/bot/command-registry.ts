import type { SlashCommandBuilder } from 'discord.js';

import { startSlashCommand } from '../domains/execution/commands/start';

/**
 * All slash command definitions registered with Discord (REST) and routed from {@link routeChatInputCommand}.
 */
export const slashCommandBuilders: SlashCommandBuilder[] = [startSlashCommand];
