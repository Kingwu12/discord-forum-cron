/**
 * Optional channel for loop behavior analytics (event lines + daily summary).
 * If unset, events log to console only.
 */

export const DEFAULT_SYSTEM_METRICS_CHANNEL_ID = '';

export function getSystemMetricsChannelId(): string {
  const v = process.env.SYSTEM_METRICS_CHANNEL_ID?.trim();
  if (v && v.length > 0) return v;
  return DEFAULT_SYSTEM_METRICS_CHANNEL_ID;
}

export function isSystemMetricsChannelConfigured(): boolean {
  return getSystemMetricsChannelId().length > 0;
}
