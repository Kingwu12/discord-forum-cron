/**
 * Execution channel for the Open Loop panel.
 * Env overrides defaults (Mode Labs test server).
 */

export const DEFAULT_EXECUTION_PANEL_GUILD_ID = '1485139623360598150';
export const DEFAULT_EXECUTION_PANEL_CHANNEL_ID = '1490324763997110374';
/** Public execution output / social proof (not the control panel). */
export const DEFAULT_EXECUTION_FEED_CHANNEL_ID = '1490338160012693605';

export function getExecutionPanelGuildId(): string {
  const v = process.env.EXECUTION_PANEL_GUILD_ID?.trim();
  return v && v.length > 0 ? v : DEFAULT_EXECUTION_PANEL_GUILD_ID;
}

export function getExecutionPanelChannelId(): string {
  const v = process.env.EXECUTION_PANEL_CHANNEL_ID?.trim();
  return v && v.length > 0 ? v : DEFAULT_EXECUTION_PANEL_CHANNEL_ID;
}

export function getExecutionFeedChannelId(): string {
  const v = process.env.EXECUTION_FEED_CHANNEL_ID?.trim();
  return v && v.length > 0 ? v : DEFAULT_EXECUTION_FEED_CHANNEL_ID;
}

/** Always on: guild/channel resolve to defaults or env. */
export function isExecutionPanelConfigured(): boolean {
  return true;
}

/**
 * Optional comma-separated Discord user ids allowed to run `/panel` in addition to
 * guild owner and members with Administrator.
 */
export function getExecutionPanelAdminUserIds(): Set<string> {
  const raw = process.env.EXECUTION_PANEL_ADMIN_USER_IDS?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
