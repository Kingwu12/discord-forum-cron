import { mergeGuildFeatures } from '../features';
import type { GuildConfig } from './types';

/**
 * Execution Layer — execution sessions domain. Replace `guildId` with the live Discord snowflake.
 */
export const executionLayerGuild: GuildConfig = {
  guildId: 'PLACEHOLDER_EXECUTION_LAYER_GUILD_ID',
  guildType: 'execution',
  features: mergeGuildFeatures({
    missionsEnabled: false,
    executionEnabled: true,
    publicSessionMessages: false,
    verdictEnabled: true,
  }),
  channels: {
    // executionChannelId: 'PLACEHOLDER_CHANNEL_ID',
  },
};
