/** Single-line commitment safe for blockquote (no newlines, length cap). */
export function sanitizeCommitmentDisplay(text: string, maxLen = 400): string {
  return text.replace(/\r?\n/g, ' ').replace(/```/g, 'ʼʼʼ').trim().slice(0, maxLen);
}

export function formatLoopOpenedFeedLine(params: {
  displayName: string;
  commitmentText: string;
}): string {
  const line = sanitizeCommitmentDisplay(params.commitmentText);
  return `${params.displayName} opened a loop\n"${line}"`;
}

export function formatLoopClosedFeedLine(params: {
  displayName: string;
  commitmentText: string;
  reflectionLabel: string;
}): string {
  const line = sanitizeCommitmentDisplay(params.commitmentText);
  return `${params.displayName} closed a loop\n"${line}"\n${params.reflectionLabel}`;
}

export function formatTodayLoopsSummary(p: {
  openedToday: number;
  closedToday: number;
  hasOpenLoop: boolean;
  openCommitmentOneLine?: string;
  /** Preformatted, e.g. "42m" or "1h 5m". */
  totalDurationClosedToday?: string;
}): string {
  const closure =
    p.openedToday > 0
      ? `${Math.round((p.closedToday / p.openedToday) * 100)}%`
      : '—';

  const lines = [
    'Today',
    `Opened: ${p.openedToday}`,
    `Closed: ${p.closedToday}`,
    `Open: ${p.hasOpenLoop ? 1 : 0}`,
    `Close rate: ${closure}`,
  ];

  if (p.totalDurationClosedToday !== undefined) {
    lines.push(`Duration (closed today): ${p.totalDurationClosedToday}`);
  }

  let tail = '';
  if (p.hasOpenLoop && p.openCommitmentOneLine) {
    tail = `\n\nOpen: ${sanitizeCommitmentDisplay(p.openCommitmentOneLine, 200)}`;
  } else if (!p.hasOpenLoop && p.closedToday > 0) {
    tail = `\n\n${p.closedToday} closed today.`;
  }

  return lines.join('\n') + tail;
}
