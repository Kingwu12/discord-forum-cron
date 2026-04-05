import { DEFAULT_GUILD_FEATURES, mergeGuildFeatures } from '../features';
import { executionLayerGuild } from './execution-layer';
import { kingdomHqGuild } from './kingdom-hq';
import type { GuildConfig } from './types';

export type { GuildConfig, GuildType } from './types';
export { executionLayerGuild } from './execution-layer';
export { kingdomHqGuild } from './kingdom-hq';

/**
 * Operator-maintained registry. One entry per guild Richard serves; differences are config-only.
 */
export const guildRegistry: GuildConfig[] = [kingdomHqGuild, executionLayerGuild];

/**
 * Resolve effective guild config for routing and domain services.
 * Known guilds: merged feature defaults + explicit registry entry.
 * Unknown guilds: `guildType` "other", default features (all off), empty channels.
 */
export function resolveGuildConfig(guildId: string): GuildConfig {
  const entry = guildRegistry.find((g) => g.guildId === guildId);
  if (!entry) {
    return {
      guildId,
      guildType: 'other',
      features: { ...DEFAULT_GUILD_FEATURES },
      channels: {},
    };
  }

  return {
    guildId: entry.guildId,
    guildType: entry.guildType,
    features: mergeGuildFeatures(entry.features),
    channels: { ...entry.channels },
  };
}
