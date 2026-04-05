/**
 * Base types for the execution domain (structure only — no persistence or commands wired yet).
 */

/** Discord snowflake ID as string */
export type DiscordSnowflake = string;

/**
 * Active execution session (hot path / in-flight).
 * End time and duration are tracked on {@link ExecutionSession} once complete.
 */
export interface ExecutionActiveSession {
  discordUserId: DiscordSnowflake;
  guildId: DiscordSnowflake;
  channelId: DiscordSnowflake;
  startedAt: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Persisted execution session record (completed or historical).
 */
export interface ExecutionSession {
  discordUserId: DiscordSnowflake;
  guildId: DiscordSnowflake;
  channelId: DiscordSnowflake;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Verdict attached to an execution session (no scoring dimensions in MVP).
 */
export interface ExecutionVerdict {
  /** Owning session record this verdict applies to */
  sessionId: string;
  discordUserId: DiscordSnowflake;
  guildId: DiscordSnowflake;
  channelId: DiscordSnowflake;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Per-guild execution feature configuration.
 */
export interface ExecutionGuildFeatures {
  guildId: DiscordSnowflake;
  createdAt: number;
  updatedAt: number;
}
