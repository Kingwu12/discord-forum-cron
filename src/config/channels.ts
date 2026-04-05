/**
 * Optional Discord channel IDs per guild (configuration only).
 * Omit keys when the guild uses defaults or does not pin a dedicated channel.
 */

export interface GuildChannelsConfig {
  /** Kingdom / missions posts (e.g. daily mission bot channel). */
  missionsChannelId?: string;
  executionChannelId?: string;
}
