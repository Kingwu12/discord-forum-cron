import { formatExecutionDurationShort } from '../formatters/execution-feed-formatter';
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
    const durationSumMs = await closedLoopRepo.sumOpenDurationMsClosedInRange(discordUserId, range);
    const open = await loopService.getOpenLoopForUser(discordUserId);

    const openCountsTowardOpenedToday =
      open !== null && open.openedAt >= range.startMs && open.openedAt < range.endMsExclusive;

    const openedToday = openedViaClosed + (openCountsTowardOpenedToday ? 1 : 0);

    return formatTodayLoopsSummary({
      openedToday,
      closedToday,
      hasOpenLoop: open !== null,
      openCommitmentOneLine: open?.commitmentText,
      totalDurationClosedToday: formatExecutionDurationShort(durationSumMs),
    });
}
