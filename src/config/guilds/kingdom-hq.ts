import { mergeGuildFeatures } from '../features';
import type { GuildConfig } from './types';

/**
 * Kingdom HQ — missions / forum automation surface. Replace `guildId` with the live Discord snowflake.
 */
export const kingdomHqGuild: GuildConfig = {
  guildId: 'PLACEHOLDER_KINGDOM_HQ_GUILD_ID',
  guildType: 'kingdom',
  features: mergeGuildFeatures({
    missionsEnabled: true,
    executionEnabled: false,
    publicSessionMessages: true,
    verdictEnabled: false,
  }),
  channels: {
    // missionsChannelId: 'PLACEHOLDER_CHANNEL_ID',
    // executionChannelId: optional if execution is enabled here later
  },
};
