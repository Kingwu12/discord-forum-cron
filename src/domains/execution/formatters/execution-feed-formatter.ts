import { EmbedBuilder } from 'discord.js';

import type { ReflectionStatus } from '../types/execution.types';

import { sanitizeCommitmentDisplay } from './loop-formatters';

const FEED_EMBED_COLOR = 0x1e1f22;

/** Human-readable duration for execution output (e.g. 42m, 1h 5m). */
export function formatExecutionDurationShort(ms: number): string {
  if (ms < 60000) return '<1m';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export type ExecutionCompleteFeedParams = {
  userId: string;
  durationMs: number;
  /** Text from when the loop was opened. */
  taskText: string;
  /** Primary completion text. */
  completionText: string;
  reflectionStatus: ReflectionStatus;
  reflectionNotes?: string;
};

export function buildExecutionCompleteEmbed(p: ExecutionCompleteFeedParams): EmbedBuilder {
  const opened = sanitizeCommitmentDisplay(p.taskText, 500);
  const executed = sanitizeCommitmentDisplay(p.completionText, 1000);
  const dur = formatExecutionDurationShort(p.durationMs);

  const embed = new EmbedBuilder()
    .setColor(FEED_EMBED_COLOR)
    .setTitle('CITADEL')
    .setDescription(
      `<@${p.userId}> completed a ${dur} execution session.\n\nLoop closed.`,
    )
    .addFields(
      { name: 'Opened', value: opened || '—', inline: false },
      { name: 'Executed', value: executed || '—', inline: false },
    );

  const notes = p.reflectionNotes?.trim();
  if (notes && notes.length > 0) {
    embed.addFields({
      name: 'Proof',
      value: sanitizeCommitmentDisplay(notes, 1000),
      inline: false,
    });
  } else {
    embed.addFields({
      name: 'State',
      value: p.reflectionStatus,
      inline: false,
    });
  }

  return embed;
}
