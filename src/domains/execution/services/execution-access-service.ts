import { resolveGuildConfig, type GuildConfig } from '../../../config/guilds';

/**
 * Minimal context for access checks. Matches discord.js interaction fields
 * (`guildId`, `channelId`) so you can pass interaction or a plain object.
 */
export type ExecutionAccessContext = {
  guildId: string | null | undefined;
  channelId: string | null | undefined;
};

/**
 * Discord interaction shape sufficient for access checks (no discord.js import required).
 */
export type ExecutionAccessInteractionLike = {
  guildId: string | null;
  channelId: string | null;
};

function hasGuildId(guildId: string | null | undefined): guildId is string {
  return typeof guildId === 'string' && guildId.length > 0;
}

function channelMatchesExecutionPin(
  config: GuildConfig,
  channelId: string | null | undefined,
): boolean {
  const pin = config.channels.executionChannelId;
  if (pin === undefined || pin === '') return true;
  return typeof channelId === 'string' && channelId === pin;
}

/**
 * Centralized execution feature / channel guards. Pure booleans — no replies or side effects.
 */
export class ExecutionAccessService {
  constructor(private readonly getGuildConfig: typeof resolveGuildConfig = resolveGuildConfig) {}

  /** True when the interaction is in a guild and execution is enabled for that guild. */
  isExecutionEnabledForGuild(guildId: string | null | undefined): boolean {
    if (!hasGuildId(guildId)) return false;
    return this.getGuildConfig(guildId).features.executionEnabled;
  }

  /**
   * True when execution commands may run: in-guild, execution on, and (when channel pin is enforced) correct channel.
   */
  canUseExecutionCommand(ctx: ExecutionAccessContext): boolean {
    if (!hasGuildId(ctx.guildId)) return false;
    const config = this.getGuildConfig(ctx.guildId);
    if (!config.features.executionEnabled) return false;
    return channelMatchesExecutionPin(config, ctx.channelId);
  }

  /**
   * True when a session-related message may be posted publicly (not ephemeral).
   * Requires execution + publicSessionMessages, and honors optional execution channel pin.
   */
  canPostPublicExecutionMessage(ctx: ExecutionAccessContext): boolean {
    if (!hasGuildId(ctx.guildId)) return false;
    const config = this.getGuildConfig(ctx.guildId);
    if (!config.features.executionEnabled) return false;
    if (!config.features.publicSessionMessages) return false;
    return channelMatchesExecutionPin(config, ctx.channelId);
  }
}

export const executionAccessService = new ExecutionAccessService();

/** Map a discord.js-style interaction to {@link ExecutionAccessContext}. */
export function toExecutionAccessContext(
  interaction: ExecutionAccessInteractionLike,
): ExecutionAccessContext {
  return { guildId: interaction.guildId, channelId: interaction.channelId };
}
