import type { Enums } from '@/lib/db/types';

/**
 * Content strategy labels and period helpers. Shared by the server and client components
 * (no server-only code).
 */
export type StrategyStatus = Enums<'strategy_status'>;
export type StrategyKpi = Enums<'strategy_kpi'>;

export const STRATEGY_STATUSES = [
  'draft',
  'active',
  'archived',
] as const satisfies readonly StrategyStatus[];

export const STRATEGY_STATUS_LABELS: Record<StrategyStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
};

export const STRATEGY_STATUS_VARIANT: Record<StrategyStatus, 'outline' | 'success' | 'muted'> = {
  draft: 'outline',
  active: 'success',
  archived: 'muted',
};

/** What a status means, for help text. */
export const STRATEGY_STATUS_HELP: Record<StrategyStatus, string> = {
  draft: 'Still being written. Content can already be linked to its objectives.',
  active: 'The plan the team works to now.',
  archived: 'Kept for reference. Its objectives are no longer offered for new content.',
};

export const STRATEGY_KPIS = [
  'published_content',
  'posts_per_week',
  'follower_growth',
  'manual',
] as const satisfies readonly StrategyKpi[];

export const KPI_LABELS: Record<StrategyKpi, string> = {
  published_content: 'Published content',
  posts_per_week: 'Posts per week',
  follower_growth: 'Follower growth',
  manual: 'Tracked outside Scopie',
};

/** How each KPI is measured, in one plain sentence. */
export const KPI_HELP: Record<StrategyKpi, string> = {
  published_content: 'Content marked published in Scopie during the period.',
  posts_per_week: 'Posts observed on your own profiles, per week.',
  follower_growth: 'Follower growth observed on your own profiles.',
  manual: 'Tracked outside Scopie; only the target is shown.',
};

/** Label for the target field of each KPI. */
export const KPI_TARGET_LABELS: Record<StrategyKpi, string> = {
  published_content: 'Pieces of content',
  posts_per_week: 'Posts per week',
  follower_growth: 'New followers',
  manual: 'Target',
};

export function isStrategyKpi(value: unknown): value is StrategyKpi {
  return typeof value === 'string' && (STRATEGY_KPIS as readonly string[]).includes(value);
}

export function isStrategyStatus(value: unknown): value is StrategyStatus {
  return typeof value === 'string' && (STRATEGY_STATUSES as readonly string[]).includes(value);
}

const NUMBER = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

/** "12 pieces of content", "3 posts per week", "+500 followers", or "No target set". */
export function formatTarget(kpi: StrategyKpi, value: number | null): string {
  if (value === null) return 'No target set';
  const n = NUMBER.format(value);
  switch (kpi) {
    case 'published_content':
      return `${n} ${value === 1 ? 'piece' : 'pieces'} of content`;
    case 'posts_per_week':
      return `${n} ${value === 1 ? 'post' : 'posts'} per week`;
    case 'follower_growth':
      return `+${n} ${value === 1 ? 'follower' : 'followers'}`;
    case 'manual':
      return n;
  }
}

/** Order on the list page: active first, then drafts, then archived; newest period first. */
const STATUS_ORDER: Record<StrategyStatus, number> = { active: 0, draft: 1, archived: 2 };

export function compareStrategies(
  a: { status: StrategyStatus; periodStart: string; name: string },
  b: { status: StrategyStatus; periodStart: string; name: string },
): number {
  return (
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    b.periodStart.localeCompare(a.periodStart) ||
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
}

// ---------------------------------------------------------------------------
// Periods. Dates are plain calendar days ("2026-10-01"), both ends included.
// ---------------------------------------------------------------------------

/** The database allows at most this many days between start and end. */
export const MAX_PERIOD_DAYS = 731;

const DAY_MS = 86_400_000;

function utcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's calendar day in a time zone, e.g. "2026-10-08". */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return isoDay(now);
  }
}

/** The calendar quarter a day falls in: 2026-11-15 → 2026-10-01 to 2026-12-31. */
export function quarterOf(day: string): { start: string; end: string } {
  const date = utcDate(day);
  const year = date.getUTCFullYear();
  const firstMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  const start = new Date(Date.UTC(year, firstMonth, 1));
  const end = new Date(Date.UTC(year, firstMonth + 3, 0));
  return { start: isoDay(start), end: isoDay(end) };
}

/** Days from start to end, both included. */
export function periodLength(start: string, end: string): number {
  return Math.round((utcDate(end).getTime() - utcDate(start).getTime()) / DAY_MS) + 1;
}

export type PeriodState = 'upcoming' | 'running' | 'ended';

export function periodState(start: string, end: string, today: string): PeriodState {
  if (today < start) return 'upcoming';
  if (today > end) return 'ended';
  return 'running';
}

export const PERIOD_STATE_LABELS: Record<PeriodState, string> = {
  upcoming: 'Not started',
  running: 'Running',
  ended: 'Ended',
};

const DAY_MONTH = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "1 Oct – 31 Dec 2026", or "1 Dec 2026 – 28 Feb 2027" across years. */
export function formatStrategyPeriod(start: string, end: string): string {
  const from = utcDate(start);
  const to = utcDate(end);
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  return `${(sameYear ? DAY_MONTH : DAY_MONTH_YEAR).format(from)} – ${DAY_MONTH_YEAR.format(to)}`;
}

/** "All markets" for an empty list, else the names (or codes) joined. */
export function scopeLabel(
  values: readonly string[],
  names: (value: string) => string,
  all: string,
): string {
  return values.length ? values.map(names).join(', ') : all;
}

/** Sum of pillar target shares, rounded to one decimal to avoid float noise. */
export function pillarTargetTotal(targets: readonly { targetShare: number }[]): number {
  return Math.round(targets.reduce((sum, target) => sum + target.targetShare, 0) * 10) / 10;
}
