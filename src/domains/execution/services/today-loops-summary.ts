import { getTodayDateKey } from '../../../shared/calendar-day';
import { isLoopExpired } from '../constants/loop-expiration';
import { formatExecutionDurationShort } from '../formatters/execution-feed-formatter';
import { sanitizeCommitmentDisplay } from '../formatters/loop-formatters';
import { formatTodayLoopsSummary } from '../formatters/loop-formatters';
import { ClosedLoopRepo } from '../repositories/closed-loop-repo';
import { LoopService } from './loop-service';

const loopService = new LoopService();
const closedLoopRepo = new ClosedLoopRepo();

/**
 * Shared copy for `/today` slash and execution-panel Today button.
 */
export async function buildTodayLoopsSummaryForUser(discordUserId: string): Promise<string> {
  const range = closedLoopRepo.todayRange();
  const openedViaClosed = await closedLoopRepo.countClosedWithOpenedAtInRange(
    discordUserId,
    range,
  );
    const closedToday = await closedLoopRepo.countClosedWithClosedAtInRange(
      discordUserId,
      range,
    );
    const openRaw = await loopService.getOpenLoopForUser(discordUserId);
    const open = openRaw && !isLoopExpired(openRaw) ? openRaw : null;

    const openCountsTowardOpenedToday =
      open !== null && open.openedAt >= range.startMs && open.openedAt < range.endMsExclusive;

    const openedToday = openedViaClosed + (openCountsTowardOpenedToday ? 1 : 0);

    return formatTodayLoopsSummary({
      openedToday,
      closedToday,
      hasOpenLoop: open !== null,
      openCommitmentOneLine: open?.commitmentText,
    });
}

export async function buildTodayClosedLoopsSummaryForContext(params: {
  guildId: string;
  channelId: string;
  resolveDisplayName: (discordUserId: string) => Promise<string>;
}): Promise<string> {
  const range = closedLoopRepo.todayRange();
  const dateKey = getTodayDateKey();
  const closedLoops = await closedLoopRepo.listClosedInContextByClosedAtRange(
    params.guildId,
    params.channelId,
    range,
  );

  if (closedLoops.length === 0) {
    return 'No loops closed yet today. Open one.';
  }

  const lines: string[] = [];
  for (const loop of closedLoops) {
    const displayName = await params.resolveDisplayName(loop.discordUserId);
    const executed = sanitizeCommitmentDisplay(loop.commitmentText, 120) || '—';
    const duration = formatExecutionDurationShort(loop.openDurationMs);
    lines.push(`${displayName} — ${executed} — ${duration}`);
  }

  return [`TODAY — ${dateKey}`, `${closedLoops.length} loops closed`, '', ...lines].join('\n');
}
