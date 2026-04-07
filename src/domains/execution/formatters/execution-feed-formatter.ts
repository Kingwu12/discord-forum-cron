import { EmbedBuilder } from 'discord.js';
import type { ReflectionStatus } from '../types/execution.types';

import { sanitizeCommitmentDisplay } from './loop-formatters';

/** Human-readable duration for execution output (e.g. 42m, 1h 5m). */
export function formatExecutionDurationShort(ms: number): string {
  if (ms < 60000) return '<1m';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export type ExecutionFeedMessageParams = {
  /** Plain-text display or global name — no @ mention. */
  username: string;
  durationMs: number;
  /** Commitment / task copy (no prefix; normalized to a single line for the feed layout). */
  task: string;
};

/**
 * Social-proof style feed copy: exactly two lines (leading ▸ only).
 * Line 1: ▸ {username} completed a {duration} loop
 * Line 2: {task}
 */
export function formatExecutionFeedMessage(p: ExecutionFeedMessageParams): string {
  const duration = formatExecutionDurationShort(p.durationMs);
  const name = p.username.replace(/\r?\n/g, ' ').trim() || '—';
  const task = p.task.replace(/\r?\n/g, ' ').trim().slice(0, 3500);
  const line1 = `▸ ${name} completed a ${duration} loop`;
  const line2 = task.length > 0 ? task : '—';
  return `${line1}\n${line2}`;
}

export type SuggestedClosePostParams = {
  durationMs: number;
  executedText: string;
  proofText?: string;
  reflectionStatus: ReflectionStatus;
};

export function buildSuggestedClosePost(p: SuggestedClosePostParams): string {
  const duration = formatExecutionDurationShort(p.durationMs);
  const executed = sanitizeCommitmentDisplay(p.executedText, 500) || '—';
  const proofText = p.proofText ? sanitizeCommitmentDisplay(p.proofText, 700) : undefined;
  const lines = [
    'closed a loop',
    `"${executed}"`,
    `duration: ${duration}`,
    `state: ${p.reflectionStatus}`,
  ];
  if (proofText) {
    lines.push(`proof: ${proofText}`);
  }

  return lines.join('\n');
}

export function buildExecutionFeedEmbed(p: {
  username: string;
  durationMs: number;
  taskText: string;
  proofImageRef?: string;
}): EmbedBuilder {
  const description = formatExecutionFeedMessage({
    username: p.username,
    durationMs: p.durationMs,
    task: p.taskText,
  });

  const embed = new EmbedBuilder().setDescription(description);

  if (p.proofImageRef) {
    embed.setImage(p.proofImageRef);
  }

  return embed;
}
