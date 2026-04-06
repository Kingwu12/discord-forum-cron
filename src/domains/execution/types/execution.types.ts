/**
 * Execution domain — Open Loop behavioral model (OPEN → EXECUTE → CLOSE).
 */

/** Discord snowflake ID as string */
export type DiscordSnowflake = string;

export type ReflectionStatus = 'moved' | 'partial' | 'stalled';

export type ProofType = 'attachment' | 'text' | 'link' | 'mixed';

/** In-flight loop: at most one per user (Firestore doc id = discordUserId). */
export interface OpenLoop {
  loopId: string;
  discordUserId: DiscordSnowflake;
  guildId: DiscordSnowflake;
  channelId: DiscordSnowflake;
  commitmentText: string;
  loopPanelMessageId?: string;
  loopPanelChannelId?: string;
  status: 'open';
  openedAt: number;
  createdAt: number;
  updatedAt: number;
}

/** Persisted closed loop (auto-generated Firestore doc id). */
export interface ClosedLoop {
  loopId: string;
  discordUserId: DiscordSnowflake;
  guildId: DiscordSnowflake;
  channelId: DiscordSnowflake;
  commitmentText: string;
  openedAt: number;
  closedAt: number;
  /** For logs / analytics — not shown in /today */
  openDurationMs: number;
  proofType: ProofType;
  proofText?: string;
  proofAttachmentUrls?: string[];
  /** Discord message id of the proof submission (panel flow), if captured. */
  proofMessageId?: string;
  reflectionStatus: ReflectionStatus;
  /** Optional free-text reflection (e.g. panel modal). */
  reflectionNotes?: string;
  createdAt: number;
  updatedAt: number;
}

export type StoredClosedLoop = ClosedLoop & { id: string };

/**
 * Verdict (future) — placeholder shape.
 */
export interface ExecutionVerdict {
  loopId: string;
  discordUserId: DiscordSnowflake;
  guildId: DiscordSnowflake;
  channelId: DiscordSnowflake;
  createdAt: number;
  updatedAt: number;
}

/** @deprecated Legacy — retained for config typing if needed elsewhere */
export interface ExecutionGuildFeatures {
  guildId: DiscordSnowflake;
  createdAt: number;
  updatedAt: number;
}
