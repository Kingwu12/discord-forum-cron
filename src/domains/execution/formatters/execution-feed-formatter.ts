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
  durationMs: number;
  executedText?: string;
  proofImageRef?: string;
  proofFallbackText?: string;
}): EmbedBuilder {
  const duration = formatExecutionDurationShort(p.durationMs);
  const executed = p.executedText ? sanitizeCommitmentDisplay(p.executedText, 500) : '';
  const proofFallbackText = p.proofFallbackText
    ? sanitizeCommitmentDisplay(p.proofFallbackText, 700)
    : undefined;

  const embed = new EmbedBuilder()
    .setTitle('Loop closed');

  if (executed.length > 0) {
    embed.addFields({ name: 'EXECUTED', value: executed, inline: true });
  }
  embed.addFields({ name: 'DURATION', value: duration, inline: true });
  if (p.proofImageRef) {
    embed.setImage(p.proofImageRef);
  } else if (proofFallbackText) {
    embed.addFields({ name: 'Proof', value: proofFallbackText, inline: false });
  }

  return embed;
}
