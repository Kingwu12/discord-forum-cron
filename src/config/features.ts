/**
 * Per-guild feature flags for Richard (configuration only).
 * Command and router code should read flags from resolved guild config, not hardcode behavior.
 */

export interface GuildFeaturesConfig {
  missionsEnabled: boolean;
  executionEnabled: boolean;
  publicSessionMessages: boolean;
  verdictEnabled: boolean;
}

/** Safe defaults when a guild is unknown or omits feature keys in the registry. */
export const DEFAULT_GUILD_FEATURES: GuildFeaturesConfig = {
  missionsEnabled: false,
  executionEnabled: false,
  publicSessionMessages: false,
  verdictEnabled: false,
};

export function mergeGuildFeatures(
  partial?: Partial<GuildFeaturesConfig>,
): GuildFeaturesConfig {
  return { ...DEFAULT_GUILD_FEATURES, ...partial };
}
