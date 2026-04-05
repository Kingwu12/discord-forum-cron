/**
 * Calendar-day helpers using `Intl` (same approach as `scripts/lib/missionBank.js`).
 * No extra date libraries.
 */

export const DEFAULT_BOT_TIMEZONE = 'Australia/Melbourne';

/** `YYYY-MM-DD` for the instant `utcMs` in the given IANA time zone. */
export function formatDateKeyInTimeZone(utcMs: number, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(utcMs));
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !d) throw new Error(`calendar-day: could not format date in ${timeZone}`);
  return `${y}-${m}-${d}`;
}

/** Today's calendar date key in `timeZone` (defaults to Melbourne, matching mission cron scripts). */
export function getTodayDateKey(timeZone: string = DEFAULT_BOT_TIMEZONE): string {
  return formatDateKeyInTimeZone(Date.now(), timeZone);
}

/** Add `deltaDays` to a `YYYY-MM-DD` key using UTC calendar arithmetic (Gregorian). */
export function addDaysToDateKey(dateKey: string, deltaDays: number): string {
  const parts = dateKey.split('-').map((x) => Number(x));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error('dateKey must be YYYY-MM-DD');
  }
  const [y, m, d] = parts;
  const u = Date.UTC(y, m - 1, d + deltaDays);
  const x = new Date(u);
  const yy = x.getUTCFullYear();
  const mm = x.getUTCMonth() + 1;
  const dd = x.getUTCDate();
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * Smallest UTC millisecond instant such that the local calendar date in `timeZone` equals `dateKey`.
 */
function findStartOfZonedDayMs(dateKey: string, timeZone: string): number {
  const parts = dateKey.split('-').map((x) => Number(x));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error('dateKey must be YYYY-MM-DD');
  }
  const [y, m, d] = parts;
  const target = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  let lo = Date.UTC(y, m - 1, d) - 48 * 3600_000;
  let hi = Date.UTC(y, m - 1, d) + 48 * 3600_000;
  while (formatDateKeyInTimeZone(lo, timeZone) > target) lo -= 24 * 3600_000;
  while (formatDateKeyInTimeZone(hi, timeZone) < target) hi += 24 * 3600_000;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const k = formatDateKeyInTimeZone(mid, timeZone);
    if (k < target) lo = mid + 1;
    else hi = mid;
  }

  if (formatDateKeyInTimeZone(lo, timeZone) !== target) {
    throw new Error(`calendar-day: could not resolve start of ${target} in ${timeZone}`);
  }
  return lo;
}

/** UTC bounds `[startMs, endMsExclusive)` for a civil `dateKey` interpreted in `timeZone`. */
export function getZonedDayUtcRange(
  dateKey: string,
  timeZone: string,
): { startMs: number; endMsExclusive: number } {
  const startMs = findStartOfZonedDayMs(dateKey, timeZone);
  const nextKey = addDaysToDateKey(dateKey, 1);
  const endMsExclusive = findStartOfZonedDayMs(nextKey, timeZone);
  return { startMs, endMsExclusive };
}
