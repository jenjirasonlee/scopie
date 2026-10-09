import { DAY_MS, formatDay, inPeriod } from './range';
import { unavailable, type Period, type Result } from './types';

const WEEK_MS = 7 * DAY_MS;
/**
 * Profiles are observed about once a day, at varying times, so an observation less than two
 * days old counts as up to date; only an older one shortens the window.
 */
export const OBSERVATION_GRACE_MS = 2 * DAY_MS;

export type Frequency = Result<{
  postsPerWeek: number;
  posts: number;
  /** The window actually counted (may be shorter than the requested period). */
  from: string;
  to: string;
  weeks: number;
  /** True when the window was shortened to the known post history; say so in the UI. */
  clipped: boolean;
  clipNote: string | null;
}>;

/**
 * Posts per week from published dates. Only time after `earliestPostAt` counts: before it,
 * Scopie may not hold every post, so missing history is never read as "no posts".
 *
 * When the known history starts after the period does, the result is unavailable unless
 * `clip` is set, in which case the window is shortened (and `clipped` says so). The end is
 * also shortened to `observedUntil` (the last observation) when that is more than two days
 * earlier. A shortened window under a week is not reported.
 */
export function postingFrequency(input: {
  publishedAt: readonly string[];
  earliestPostAt: string | null;
  period: Period;
  observedUntil?: string | null;
  clip?: boolean;
}): Frequency {
  const { period, earliestPostAt } = input;
  if (!earliestPostAt) {
    return unavailable(
      'history_start_unknown',
      'Scopie hasn’t finished loading this profile’s post history yet.',
    );
  }
  const historyStart = Date.parse(earliestPostAt);
  let start = period.start.getTime();
  let end = period.end.getTime();
  const notes: string[] = [];
  if (historyStart > start) {
    if (!input.clip) {
      return unavailable(
        'history_starts_after_range',
        `Post history starts ${formatDay(earliestPostAt)}, after the start of this period.`,
      );
    }
    start = historyStart;
    notes.push(`counted from ${formatDay(earliestPostAt)}, when the post history starts`);
  }
  if (input.observedUntil) {
    const until = Date.parse(input.observedUntil);
    if (until < end - OBSERVATION_GRACE_MS) {
      end = until;
      notes.push(`counted up to ${formatDay(input.observedUntil)}, the last observation`);
    }
  }
  // A 7-day period that ends now is a little under 7 × 24 hours; a shortened window must
  // still span at least a week (or the whole period, if that is shorter).
  const minimum = Math.min(WEEK_MS, period.end.getTime() - period.start.getTime());
  if (end - start < minimum) {
    return unavailable(
      'window_too_short',
      `Less than a week of complete post history in this period (from ${formatDay(new Date(start))}).`,
    );
  }
  const window: Period = { start: new Date(start), end: new Date(end) };
  const posts = input.publishedAt.filter((at) => inPeriod(at, window)).length;
  const weeks = (end - start) / WEEK_MS;
  return {
    status: 'ok',
    postsPerWeek: posts / weeks,
    posts,
    from: window.start.toISOString(),
    to: window.end.toISOString(),
    weeks,
    clipped: notes.length > 0,
    clipNote: notes.length ? `Shortened: ${notes.join('; ')}.` : null,
  };
}

/** True when the profile's post history covers the whole period. */
export function historyCovers(
  earliestPostAt: string | null,
  period: Period,
  observedUntil?: string | null,
): boolean {
  if (earliestPostAt === null || Date.parse(earliestPostAt) > period.start.getTime()) return false;
  return !observedUntil || Date.parse(observedUntil) >= period.end.getTime() - OBSERVATION_GRACE_MS;
}
