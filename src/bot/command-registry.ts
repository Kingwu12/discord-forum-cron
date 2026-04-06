import type {
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';

import { endSlashCommand } from '../domains/execution/commands/end';
import { startSlashCommand } from '../domains/execution/commands/start';
import { todaySlashCommand } from '../domains/execution/commands/today';
import { panelSlashCommand } from './panel-command';

type RegisteredSlashCommand =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder;

/**
 * All slash command definitions registered with Discord (REST) and routed from {@link routeChatInputCommand}.
 */
export const slashCommandBuilders: RegisteredSlashCommand[] = [
  startSlashCommand,
  endSlashCommand,
  todaySlashCommand,
  panelSlashCommand,
];
