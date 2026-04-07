/**
 * Lightweight loop funnel analytics: console + optional Discord metrics channel.
 * ENTER → START → CLOSE → EXPIRE (+ BLOCKED). Daily roll-up with in-memory counts (resets on process restart).
 */

import type { Client } from 'discord.js';

import { getSystemMetricsChannelId } from '../../config/system-metrics-env';
import { formatExecutionDurationShort } from '../../domains/execution/formatters/execution-feed-formatter';
import { getTodayDateKey } from '../calendar-day';

export type LoopAnalyticsEventType = 'ENTER' | 'START' | 'CLOSE' | 'EXPIRE' | 'BLOCKED';

export type LoopAnalyticsPayload = {
  userId?: string;
  /** Plain label for logs (display name or username, no @). */
  username?: string;
  durationMs?: number;
  /** e.g. slash / button / modal */
  detail?: string;
};

type DayBucket = {
  dateKey: string;
  entered: number;
  started: number;
  closed: number;
  expired: number;
  userStarted: Map<string, number>;
  userClosed: Map<string, number>;
  /** userId → latest display label */
  userLabels: Map<string, string>;
};

function emptyBucket(dateKey: string): DayBucket {
  return {
    dateKey,
    entered: 0,
    started: 0,
    closed: 0,
    expired: 0,
    userStarted: new Map(),
    userClosed: new Map(),
    userLabels: new Map(),
  };
}

let bucket: DayBucket = emptyBucket(getTodayDateKey());

function rememberLabel(userId: string | undefined, username: string | undefined): void {
  if (userId && username) bucket.userLabels.set(userId, username);
}

function bumpMap(m: Map<string, number>, userId: string, by: number): void {
  m.set(userId, (m.get(userId) ?? 0) + by);
}

/** Human-readable single line for console + Discord event stream. */
export function formatLoopAnalyticsLine(type: LoopAnalyticsEventType, p: LoopAnalyticsPayload): string {
  const name = p.username ?? p.userId ?? 'unknown';
  if (type === 'CLOSE' && p.durationMs != null) {
    return `${type} → ${name} (${formatExecutionDurationShort(p.durationMs)})`;
  }
  if (type === 'BLOCKED' && p.detail) {
    return `${type} → ${name} (${p.detail})`;
  }
  return `${type} → ${name}`;
}

function applyToBucket(type: LoopAnalyticsEventType, p: LoopAnalyticsPayload): void {
  rememberLabel(p.userId, p.username);
  switch (type) {
    case 'ENTER':
      bucket.entered += 1;
      break;
    case 'START':
      bucket.started += 1;
      if (p.userId) bumpMap(bucket.userStarted, p.userId, 1);
      break;
    case 'CLOSE':
      bucket.closed += 1;
      if (p.userId) bumpMap(bucket.userClosed, p.userId, 1);
      break;
    case 'EXPIRE':
      bucket.expired += 1;
      break;
    case 'BLOCKED':
      break;
    default:
      break;
  }
}

function ratioLine(a: number, b: number): string {
  if (b <= 0) return '—';
  return `${a} / ${b}`;
}

function buildDaySummaryBody(finished: DayBucket): string {
  const { entered, started, closed, expired, dateKey, userStarted, userClosed, userLabels } = finished;
  const lines = [
    `DAY SUMMARY — ${dateKey}`,
    '',
    `Entered: ${entered}`,
    `Started: ${started}`,
    `Closed: ${closed}`,
    `Expired: ${expired}`,
    '',
    `Activation: ${ratioLine(started, entered)}`,
    `Completion: ${ratioLine(closed, started)}`,
  ];

  const userIds = new Set<string>([...userStarted.keys(), ...userClosed.keys()]);
  if (userIds.size > 0) {
    const detailLines: string[] = ['', 'By user:'];
    const sorted = [...userIds].sort();
    let n = 0;
    for (const uid of sorted) {
      if (n >= 25) {
        detailLines.push(`… +${userIds.size - 25} more`);
        break;
      }
      const s = userStarted.get(uid) ?? 0;
      const c = userClosed.get(uid) ?? 0;
      if (s === 0 && c === 0) continue;
      const label = userLabels.get(uid) ?? uid;
      detailLines.push(`${label}: ${s} started, ${c} closed`);
      n++;
    }
    if (detailLines.length > 2) lines.push(...detailLines);
  }

  return lines.join('\n');
}

async function sendMetricsMessage(client: Client, content: string): Promise<void> {
  const channelId = getSystemMetricsChannelId();
  if (!channelId) return;
  try {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch?.isSendable()) return;
    await ch.send({ content: content.slice(0, 2000) });
  } catch {
    /* ignore */
  }
}

async function postFinishedDaySummary(client: Client | null, finished: DayBucket): Promise<void> {
  const body = buildDaySummaryBody(finished);
  console.log(`[loop-analytics]\n${body}`);
  if (client) await sendMetricsMessage(client, body);
}

/** If the calendar day changed, move counts to a new bucket and post summary for the finished day. */
function rollBucketIfNeeded(): DayBucket | null {
  const today = getTodayDateKey();
  if (bucket.dateKey === today) return null;
  const finished = bucket;
  bucket = emptyBucket(today);
  return finished;
}

/**
 * Log one funnel event (console + metrics channel when configured).
 * Safe to call with `client === null` (console + in-memory counts only).
 */
export async function logEvent(
  client: Client | null,
  type: LoopAnalyticsEventType,
  payload: LoopAnalyticsPayload,
): Promise<void> {
  const finished = rollBucketIfNeeded();
  if (finished) {
    await postFinishedDaySummary(client, finished);
  }

  applyToBucket(type, payload);
  const line = formatLoopAnalyticsLine(type, payload);
  console.log(`[loop-analytics] ${line}`);
  if (client) {
    await sendMetricsMessage(client, line);
  }
}

/**
 * Hourly safety net: if the bot was quiet across midnight, still roll and post the previous day.
 */
export function tickAnalyticsDayRollover(client: Client): void {
  void (async () => {
    const finished = rollBucketIfNeeded();
    if (finished) await postFinishedDaySummary(client, finished);
  })();
}
