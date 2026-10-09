import { zonedDateTimeToUtc } from '@/lib/calendar/time';
import type { Period } from '@/lib/analytics/types';
import { MIN_POSTS_FOR_COMPARISON, postEngagement } from '@/lib/analytics/engagement';
import { median } from '@/lib/analytics/stats';
import type { PostRecord } from '@/lib/analytics/types';
import { quarterOf } from '@/lib/strategy/shared';

// Productivity and "Your impact": pure calculations and labels, safe in the browser.
// Every number comes from records Scopie keeps (content, stage history, review decisions,
// reports, analyses). Team numbers are always for the whole team, never per person.

// ---------------------------------------------------------------------------
// Views and periods
// ---------------------------------------------------------------------------

export const PRODUCTIVITY_VIEWS = ['team', 'you'] as const;
export type ProductivityView = (typeof PRODUCTIVITY_VIEWS)[number];

export const VIEW_LABELS: Record<ProductivityView, string> = {
  team: 'Team',
  you: 'Your impact',
};

export const PERIOD_KEYS = ['this_quarter', 'last_quarter', 'last_90_days'] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  this_quarter: 'This quarter',
  last_quarter: 'Last quarter',
  last_90_days: 'Last 90 days',
};

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseView(value: string | string[] | undefined): ProductivityView {
  const v = single(value);
  return PRODUCTIVITY_VIEWS.includes(v as ProductivityView) ? (v as ProductivityView) : 'team';
}

export function parsePeriodKey(value: string | string[] | undefined): PeriodKey {
  const v = single(value);
  return PERIOD_KEYS.includes(v as PeriodKey) ? (v as PeriodKey) : 'this_quarter';
}

export function productivityHref(orgSlug: string, view: ProductivityView, period: PeriodKey) {
  const params = new URLSearchParams();
  if (view !== 'team') params.set('view', view);
  if (period !== 'this_quarter') params.set('period', period);
  const query = params.toString();
  return `/${orgSlug}/productivity${query ? `?${query}` : ''}`;
}

/** Calendar days, both included ("2026-10-01" to "2026-10-09"). */
export type DayRange = { start: string; end: string };

const DAY_MS = 86_400_000;

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Days in a range, both ends included. */
export function rangeDays(range: DayRange): number {
  return (
    Math.round(
      (Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / DAY_MS,
    ) + 1
  );
}

export type ProductivityPeriod = {
  key: PeriodKey;
  /** The days counted: for this quarter, from its first day to today. */
  range: DayRange;
  /** The whole calendar period (for this quarter, to its last day). */
  full: DayRange;
  /** The period before, of the same length, or null when there is none to compare. */
  comparison: DayRange | null;
  /** How the comparison is described: "the same 9 days of last quarter". */
  comparisonLabel: string | null;
  /** Why there is no comparison, when it was dropped. */
  noComparison?: string;
};

/**
 * Drops the comparison when it starts before the organization existed in Scopie: those
 * days hold no records, so comparing with them would show zeros that were never measured.
 */
export function withinRecords(period: ProductivityPeriod, firstDay: string): ProductivityPeriod {
  if (!period.comparison || period.comparison.start >= firstDay) return period;
  return {
    ...period,
    comparison: null,
    comparisonLabel: null,
    noComparison: `No comparison: Scopie has no records for this organization before ${DAY_MONTH_YEAR.format(new Date(`${firstDay}T00:00:00Z`))}.`,
  };
}

/**
 * The period to count, in the organization's calendar. This quarter runs to today and is
 * compared with the same number of days at the start of last quarter, so a quarter in
 * progress is never compared with a whole one.
 */
export function productivityPeriod(key: PeriodKey, today: string): ProductivityPeriod {
  if (key === 'this_quarter') {
    const full = quarterOf(today);
    const range = { start: full.start, end: today };
    const days = rangeDays(range);
    const previous = quarterOf(addDays(full.start, -1));
    const end = addDays(previous.start, days - 1);
    return {
      key,
      range,
      full,
      comparison: { start: previous.start, end: end > previous.end ? previous.end : end },
      comparisonLabel: `the first ${days} ${days === 1 ? 'day' : 'days'} of last quarter`,
    };
  }
  if (key === 'last_quarter') {
    const range = quarterOf(addDays(quarterOf(today).start, -1));
    return {
      key,
      range,
      full: range,
      comparison: quarterOf(addDays(range.start, -1)),
      comparisonLabel: 'the quarter before',
    };
  }
  const range = { start: addDays(today, -89), end: today };
  return {
    key,
    range,
    full: range,
    comparison: { start: addDays(today, -179), end: addDays(today, -90) },
    comparisonLabel: 'the 90 days before',
  };
}

/** A day range as instants: from the first day's midnight to the midnight after the last. */
export function rangeInstants(range: DayRange, timeZone: string): Period {
  return {
    start: zonedDateTimeToUtc(range.start, '00:00', timeZone),
    end: zonedDateTimeToUtc(addDays(range.end, 1), '00:00', timeZone),
  };
}

export function inInstants(at: string | null | undefined, period: Period): boolean {
  if (!at) return false;
  const t = Date.parse(at);
  return t >= period.start.getTime() && t < period.end.getTime();
}

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

/** "1 Oct – 9 Oct 2026", or "1 Dec 2025 – 28 Feb 2026" across years. */
export function formatRange(range: DayRange): string {
  const from = new Date(`${range.start}T00:00:00Z`);
  const to = new Date(`${range.end}T00:00:00Z`);
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  return `${(sameYear ? DAY_MONTH : DAY_MONTH_YEAR).format(from)} – ${DAY_MONTH_YEAR.format(to)}`;
}

// ---------------------------------------------------------------------------
// Review cycles
// ---------------------------------------------------------------------------

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

/** One review decision on one submitted version. */
export type ReviewRecord = {
  id: string;
  itemId: string;
  decision: ReviewDecision;
  decidedAt: string;
  /** When the version was sent for review; null when it isn't known. */
  submittedAt: string | null;
};

export type ReviewStats = {
  decisions: number;
  approved: number;
  changesRequested: number;
  rejected: number;
  /** Mean review rounds per approval, or null without approvals. */
  roundsPerApproval: number | null;
  /** Share (0–1) of approvals that came on the first round, or null without approvals. */
  firstTimeShare: number | null;
  /** Median hours from sent for review to decision, or null without timed decisions. */
  medianHoursInReview: number | null;
  /** Decisions with a known sending time, i.e. the sample behind the median. */
  timedDecisions: number;
};

/**
 * Review numbers for decisions made inside `period`. A review round is one sending for
 * review that got a decision (withdrawn sendings aren't rounds). The rounds behind an
 * approval are the decisions on that item since its previous approval, the approval
 * included, so `reviews` must hold every earlier decision on the approved items.
 */
export function reviewStats(reviews: readonly ReviewRecord[], period: Period): ReviewStats {
  const sorted = [...new Map(reviews.map((r) => [r.id, r])).values()].sort(
    (a, b) => Date.parse(a.decidedAt) - Date.parse(b.decidedAt),
  );
  const inside = sorted.filter((r) => inInstants(r.decidedAt, period));

  const roundsSince = new Map<string, number>();
  const approvalRounds: number[] = [];
  for (const review of sorted) {
    const rounds = (roundsSince.get(review.itemId) ?? 0) + 1;
    if (review.decision === 'APPROVED') {
      if (inInstants(review.decidedAt, period)) approvalRounds.push(rounds);
      roundsSince.set(review.itemId, 0);
    } else {
      roundsSince.set(review.itemId, rounds);
    }
  }

  const hours = inside
    .filter((r) => r.submittedAt !== null)
    .map((r) => (Date.parse(r.decidedAt) - Date.parse(r.submittedAt!)) / 3_600_000)
    .filter((h) => Number.isFinite(h) && h >= 0);

  return {
    decisions: inside.length,
    approved: inside.filter((r) => r.decision === 'APPROVED').length,
    changesRequested: inside.filter((r) => r.decision === 'CHANGES_REQUESTED').length,
    rejected: inside.filter((r) => r.decision === 'REJECTED').length,
    roundsPerApproval: approvalRounds.length
      ? approvalRounds.reduce((sum, n) => sum + n, 0) / approvalRounds.length
      : null,
    firstTimeShare: approvalRounds.length
      ? approvalRounds.filter((n) => n === 1).length / approvalRounds.length
      : null,
    medianHoursInReview: median(hours),
    timedDecisions: hours.length,
  };
}

/** "45 min", "5.5 hours", "2.3 days". */
export function formatHours(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${trim(hours)} ${trim(hours) === '1' ? 'hour' : 'hours'}`;
  return `${trim(hours / 24)} days`;
}

function trim(value: number): string {
  return value.toLocaleString('en-GB', { maximumFractionDigits: 1 });
}

// ---------------------------------------------------------------------------
// Publishing consistency
// ---------------------------------------------------------------------------

/** Monday of the week a day falls in. */
export function mondayOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

export type Consistency = {
  /** Calendar weeks (Monday to Sunday) that overlap the range, partial ones included. */
  weeks: number;
  weeksWithPublished: number;
  published: number;
  /** Published items per 7 days of the range. */
  perWeek: number;
};

/**
 * How steadily content was published: weeks in the range with at least one item marked
 * published, and the average per week. `publishedDays` are the local calendar days items
 * were published on.
 */
export function publishingConsistency(
  publishedDays: readonly string[],
  range: DayRange,
): Consistency {
  const counted = publishedDays.filter((day) => day >= range.start && day <= range.end);
  const weeks = new Set<string>();
  for (let monday = mondayOf(range.start); monday <= range.end; monday = addDays(monday, 7)) {
    weeks.add(monday);
  }
  const withPublished = new Set(counted.map(mondayOf));
  return {
    weeks: weeks.size,
    weeksWithPublished: [...withPublished].filter((w) => weeks.has(w)).length,
    published: counted.length,
    perWeek: counted.length / (rangeDays(range) / 7),
  };
}

// ---------------------------------------------------------------------------
// Report automation
// ---------------------------------------------------------------------------

/** An assumption, stated as one, never a measurement. */
export const HOURS_PER_HAND_MADE_REPORT = 2;

/** The labelled estimate of time saved by automatic reports. */
export function timeSavedSentence(automaticReports: number): string {
  const hours = automaticReports * HOURS_PER_HAND_MADE_REPORT;
  return `Estimate, not measured: if a weekly report takes about ${HOURS_PER_HAND_MADE_REPORT} hours to put together by hand, ${automaticReports} automatic ${automaticReports === 1 ? 'report' : 'reports'} saved about ${hours} ${hours === 1 ? 'hour' : 'hours'}.`;
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

export type Tile = {
  key: string;
  label: string;
  /** Null when it can't be measured; `unavailable` says why. */
  value: number | null;
  display: string;
  unavailable?: string;
  /** The same number for the comparison period; null when it can't be measured there. */
  previous?: number | null;
  previousDisplay?: string;
  /** One line on what was counted. */
  basis: string;
  href?: string;
};

export const formatCount = (n: number) => n.toLocaleString('en-GB');
export const formatPercent = (share: number) => `${Math.round(share * 100)}%`;
export const formatOne = (n: number) => n.toLocaleString('en-GB', { maximumFractionDigits: 1 });

/** "Up 3 on …", "Down 20% …": the change from the comparison, in words. */
export function changeLine(tile: Tile, comparisonLabel: string | null): string | null {
  if (!comparisonLabel || tile.previous === undefined) return null;
  if (tile.previous === null || tile.previousDisplay === undefined) {
    return `No comparison: not measurable in ${comparisonLabel}.`;
  }
  return `${capitalize(comparisonLabel)}: ${tile.previousDisplay}`;
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Results of your content
// ---------------------------------------------------------------------------

export type PostVersusUsual =
  | {
      status: 'compared';
      /** Likes + comments at 7 days old. */
      value: number;
      /** Median of the profile's other posts in the period, same measure. */
      usual: number;
      /** Other posts behind the median. */
      sample: number;
      above: boolean;
    }
  | { status: 'not_compared'; reason: string };

/**
 * One post made from your content against its profile's usual post: public engagement
 * (likes + comments) at 7 days old, next to the median of the profile's other posts
 * published in the same period, from the same data source. Needs enough other posts.
 */
export function postVersusUsual(
  post: PostRecord,
  profilePosts: readonly PostRecord[],
  period: Period,
): PostVersusUsual {
  const own = postEngagement(post);
  if (own.status === 'hidden_by_owner') {
    return { status: 'not_compared', reason: 'The profile hides like counts on this post.' };
  }
  if (own.status === 'missing') {
    return { status: 'not_compared', reason: 'No likes and comments recorded at 7 days old yet.' };
  }
  const values: number[] = [];
  for (const other of profilePosts) {
    if (other.id === post.id || !inInstants(other.publishedAt, period)) continue;
    const e = postEngagement(other);
    if (e.status === 'ok' && e.dataSource === own.dataSource) values.push(e.value);
  }
  if (values.length < MIN_POSTS_FOR_COMPARISON) {
    return {
      status: 'not_compared',
      reason: `Too few other measured posts on this profile in the period to know its usual (${values.length} of ${MIN_POSTS_FOR_COMPARISON} needed).`,
    };
  }
  const usual = median(values)!;
  return {
    status: 'compared',
    value: own.value,
    usual,
    sample: values.length,
    above: own.value > usual,
  };
}

// ---------------------------------------------------------------------------
// Your impact summary
// ---------------------------------------------------------------------------

export type ImpactCounts = {
  recommendationsActedOn: number;
  ideasFromRecommendations: number;
  created: number;
  published: number;
  campaigns: number;
  markets: number;
  reviews: number;
  approvedByYou: number;
  reportsByHand: number;
  /** Linked posts compared with their profile's usual post; null when none could be. */
  postsCompared: number | null;
  postsAboveUsual: number;
};

export type ImpactSentence = { text: string; href: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Three to five plain sentences built only from the counts, each linking to its evidence
 * (a section of this page that lists the records). No scores, no comparison with anyone.
 */
export function impactSummary(counts: ImpactCounts, periodWords: string): ImpactSentence[] {
  const out: ImpactSentence[] = [];
  if (counts.created || counts.published) {
    const parts = [];
    if (counts.created) parts.push(`created ${plural(counts.created, 'content item')}`);
    if (counts.published) parts.push(`marked ${plural(counts.published, 'item')} as published`);
    out.push({ text: `You ${parts.join(' and ')} ${periodWords}.`, href: '#your-content' });
  }
  if (counts.campaigns || counts.markets) {
    const parts = [];
    if (counts.campaigns) parts.push(plural(counts.campaigns, 'campaign'));
    if (counts.markets) parts.push(plural(counts.markets, 'market'));
    out.push({
      text: `Your content covered ${parts.join(' and ')}.`,
      href: '#campaigns-markets',
    });
  }
  if (counts.recommendationsActedOn || counts.ideasFromRecommendations) {
    const parts = [];
    if (counts.recommendationsActedOn)
      parts.push(`acted on ${plural(counts.recommendationsActedOn, 'AI recommendation')}`);
    if (counts.ideasFromRecommendations)
      parts.push(
        `turned recommendations into ${plural(counts.ideasFromRecommendations, 'content idea')}`,
      );
    out.push({ text: `You ${parts.join(' and ')}.`, href: '#recommendations' });
  }
  if (counts.reviews) {
    out.push({
      text: `You made ${plural(counts.reviews, 'review decision')}${counts.approvedByYou ? `, approving ${counts.approvedByYou}` : ''}.`,
      href: '#reviews',
    });
  }
  if (counts.reportsByHand) {
    out.push({
      text: `You made ${plural(counts.reportsByHand, 'weekly report')} by hand.`,
      href: '#reports',
    });
  }
  if (counts.postsCompared) {
    out.push({
      text: `${counts.postsAboveUsual} of ${plural(counts.postsCompared, 'linked post')} from your content got more engagement than its profile’s usual post.`,
      href: '#performance',
    });
  }
  if (!out.length) {
    return [
      {
        text: `Scopie hasn’t recorded any content, reviews, recommendations or reports from you ${periodWords}.`,
        href: '#your-content',
      },
    ];
  }
  return out.slice(0, 5);
}

/** "this quarter so far", "last quarter", "in the last 90 days". */
export const PERIOD_WORDS: Record<PeriodKey, string> = {
  this_quarter: 'this quarter so far',
  last_quarter: 'last quarter',
  last_90_days: 'in the last 90 days',
};
