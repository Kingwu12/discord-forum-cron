import type { GuildChannelsConfig } from '../channels';
import type { GuildFeaturesConfig } from '../features';

export type GuildType = 'kingdom' | 'execution' | 'other';

/**
 * Full guild entry for Richard: identity, classification, features, and optional channel pins.
 * Per-guild files under this folder register into {@link guildRegistry}.
 */
export interface GuildConfig {
  guildId: string;
  guildType: GuildType;
  features: GuildFeaturesConfig;
  channels: GuildChannelsConfig;
}
