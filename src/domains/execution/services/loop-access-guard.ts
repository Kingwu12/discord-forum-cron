/**
 * Loop Access role gate (see `LOOP_ACCESS_ROLE_ID` / `getLoopAccessRoleId` in execution-panel-env).
 * Centralizes checks so handlers only call `requireLoopAccess` / `hasLoopAccessMember`.
 */

import {
  type APIInteractionGuildMember,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  GuildMember,
  type ModalSubmitInteraction,
} from 'discord.js';

import { getLoopAccessRoleId } from '../../../config/execution-panel-env';
import { logEvent } from '../../../shared/analytics/loop-behavior-analytics';

/** Same copy for interaction ephemerals and DM when proof-close is blocked. */
export const LOOP_ACCESS_GATE_MESSAGE = [
  "You're viewing the system.",
  '',
  'To participate:',
  '→ go to #🟢・start-here',
  '→ react with ⚡',
  '',
  'Then come back.',
].join('\n');

type GateableInteraction = ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction;

export function hasLoopAccessMember(
  member: GuildMember | APIInteractionGuildMember | null | undefined,
): boolean {
  if (!member) return false;
  const roleId = getLoopAccessRoleId();
  if (member instanceof GuildMember) {
    return member.roles.cache.has(roleId);
  }
  return member.roles.includes(roleId);
}

async function resolveMemberForGate(
  interaction: GateableInteraction,
): Promise<GuildMember | APIInteractionGuildMember | null> {
  if (!interaction.inGuild()) return null;
  if (interaction.member) return interaction.member;
  if (!interaction.guild) return null;
  try {
    return await interaction.guild.members.fetch(interaction.user.id);
  } catch {
    return null;
  }
}

/**
 * Sends `LOOP_ACCESS_GATE_MESSAGE` ephemerally, respecting defer/reply state.
 * - Not deferred, not replied → `reply`
 * - Deferred (initial response pending) → `editReply`
 * - Already fully replied → `followUp`
 */
export async function replyLoopAccessDenied(interaction: GateableInteraction): Promise<void> {
  const ephemeralPayload = { content: LOOP_ACCESS_GATE_MESSAGE, ephemeral: true as const };
  try {
    if (interaction.deferred) {
      await interaction.editReply({ content: LOOP_ACCESS_GATE_MESSAGE });
      return;
    }
    if (interaction.replied) {
      await interaction.followUp(ephemeralPayload);
      return;
    }
    await interaction.reply(ephemeralPayload);
  } catch {
    try {
      await interaction.followUp(ephemeralPayload);
    } catch {
      /* ignore */
    }
  }
}

/**
 * @returns `true` if the member has Loop Access and the handler should continue.
 * @returns `false` if access was denied (ephemeral reply already sent).
 */
export async function requireLoopAccess(interaction: GateableInteraction): Promise<boolean> {
  const member = await resolveMemberForGate(interaction);
  if (hasLoopAccessMember(member)) return true;
  await replyLoopAccessDenied(interaction);
  const username = interaction.user.globalName ?? interaction.user.username;
  void logEvent(interaction.client, 'BLOCKED', {
    userId: interaction.user.id,
    username,
    detail: 'loop_access',
  });
  return false;
}
