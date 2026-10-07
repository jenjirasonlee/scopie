import { DATA_SOURCE_LABELS } from '@/lib/accounts/labels';
import {
  checkComparable,
  comparableValue,
  compareValues,
  REFUSAL_LABELS,
  roleGroup,
  summarizeGroups,
  type ComparableValue,
  type GroupSummary,
} from './compare';
import { ENGAGEMENT_AGE_DAYS, MIN_POSTS_FOR_COMPARISON, publicEngagement } from './engagement';
import {
  formatCompact,
  formatCount,
  formatDecimal,
  formatSignedCount,
  formatSignedPercent,
} from './format';
import { postingFrequency } from './frequency';
import { latestFollowers, observedGrowth } from './growth';
import { platformName } from './names';
import { formatDay, formatPeriod, inPeriod, shiftPeriod } from './range';
import { median } from './stats';
import {
  unavailable,
  type DataSource,
  type FollowerObservation,
  type Period,
  type PostRecord,
  type ProfileRecord,
  type Unavailable,
} from './types';

/* -------------------------------------------------------------------------------------------
 * Metrics a benchmark can rank on
 * ----------------------------------------------------------------------------------------- */

export const BENCHMARK_METRICS = [
  'follower_growth',
  'posts_per_week',
  'median_engagement',
  'followers',
] as const;
export type BenchmarkMetric = (typeof BENCHMARK_METRICS)[number];
export const DEFAULT_BENCHMARK_METRIC: BenchmarkMetric = 'follower_growth';

export const BENCHMARK_METRIC_INFO: Record<
  BenchmarkMetric,
  {
    label: string;
    /** Key in the metric dictionary (lib/metrics/registry.ts). */
    metricKey: string;
    scope: 'account' | 'post';
    /** How the value is described in a ranking's basis sentence. */
    basis: string;
    help: string;
  }
> = {
  follower_growth: {
    label: 'Observed follower growth',
    metricKey: 'follower_growth_rate',
    scope: 'account',
    basis: 'observed follower growth',
    help: 'Change between the first and the last follower count Scopie observed in the period. Nothing before the first observation is estimated.',
  },
  posts_per_week: {
    label: 'Posts per week',
    metricKey: 'posts_published',
    scope: 'account',
    basis: 'posts per week',
    help: 'Posts published in the period, per week. Only profiles whose post history covers the whole period are ranked, so missing history never counts as “no posts”.',
  },
  median_engagement: {
    label: 'Median public engagement per post',
    metricKey: 'public_engagement',
    scope: 'post',
    basis: `median public engagement per post (likes + comments at ${ENGAGEMENT_AGE_DAYS} days old)`,
    help: `Median likes + comments per post, measured when each post was ${ENGAGEMENT_AGE_DAYS} days old. Needs at least ${MIN_POSTS_FOR_COMPARISON} measured posts; posts with hidden likes are left out.`,
  },
  followers: {
    label: 'Followers',
    metricKey: 'followers',
    scope: 'account',
    basis: 'followers at the last observation',
    help: 'The last follower count Scopie observed in the period, with its date.',
  },
};

/** Reads `?metric=`; anything unknown falls back to observed follower growth. */
export function parseMetricParam(value: string | string[] | undefined): BenchmarkMetric {
  const raw = Array.isArray(value) ? value[0] : value;
  return (BENCHMARK_METRICS as readonly string[]).includes(raw ?? '')
    ? (raw as BenchmarkMetric)
    : DEFAULT_BENCHMARK_METRIC;
}

export function formatBenchmarkValue(metric: BenchmarkMetric, value: number): string {
  switch (metric) {
    case 'follower_growth':
      return formatSignedPercent(value);
    case 'posts_per_week':
      return formatDecimal(value);
    case 'median_engagement':
      return formatCount(value);
    case 'followers':
      return formatCompact(value);
  }
}

/* -------------------------------------------------------------------------------------------
 * Measuring one profile
 * ----------------------------------------------------------------------------------------- */

/** Everything stored for one profile that a benchmark needs. */
export type BenchmarkProfileData = {
  profile: ProfileRecord;
  /** Follower observations (any source; only the comparison source is used). */
  followers: readonly FollowerObservation[];
  /** Posts with likes and comments at the fixed age attached where measured. */
  posts: readonly PostRecord[];
};

export type Measurement =
  | {
      status: 'ok';
      value: number;
      comparable: ComparableValue;
      /** Sources of the stored values behind the number (shown as badges). */
      sources: DataSource[];
      /** How many observations or posts the number rests on. */
      sampleSize: number;
      sampleUnit: 'observations' | 'posts' | 'observation';
      /** Plain-language note on what the number is made of. */
      sample: string;
      /** When the measured window differs from the period (engagement window, observation date). */
      measuredAt?: string;
    }
  | (Unavailable & {
      /** A more precise short label than the reason's, e.g. "likes hidden by owner". */
      label?: string;
    });

/** The window of posts whose engagement at the fixed age is read during `period`. */
export function engagementWindow(period: Period): Period {
  return shiftPeriod(period, ENGAGEMENT_AGE_DAYS);
}

/**
 * One profile's value for one metric over one period, from stored observations only, or the
 * reason it can't be given. Values of other data sources than `source` are ignored, so a
 * connected profile is measured on the same public values as a competitor.
 */
export function measure(
  metric: BenchmarkMetric,
  data: BenchmarkProfileData,
  period: Period,
  source: DataSource,
): Measurement {
  const { profile } = data;
  const comparable = (value: number, dataSource: DataSource) =>
    comparableValue({
      platformKey: profile.platformKey,
      scope: BENCHMARK_METRIC_INFO[metric].scope,
      metricKey: BENCHMARK_METRIC_INFO[metric].metricKey,
      dataSource,
      value,
    });

  switch (metric) {
    case 'follower_growth': {
      const growth = observedGrowth(
        data.followers.filter((o) => o.dataSource === source),
        period,
      );
      if (growth.status !== 'ok') return growth;
      if (growth.rate === null) {
        return unavailable('no_baseline', 'The first observed follower count was 0.');
      }
      return {
        status: 'ok',
        value: growth.rate,
        comparable: comparable(growth.rate, growth.dataSource),
        sources: [growth.dataSource],
        sampleSize: growth.observations,
        sampleUnit: 'observations',
        sample: `${formatCount(growth.first.value)} on ${formatDay(growth.first.at)} → ${formatCount(growth.last.value)} on ${formatDay(growth.last.at)} (${formatSignedCount(growth.change)})`,
      };
    }
    case 'posts_per_week': {
      const frequency = postingFrequency({
        publishedAt: data.posts.map((p) => p.publishedAt),
        earliestPostAt: profile.earliestPostAt,
        observedUntil: profile.lastObservedAt,
        period,
        // Rankings compare everyone over the same window: no shortened windows.
        clip: false,
      });
      if (frequency.status !== 'ok') return frequency;
      const window = { start: new Date(frequency.from), end: new Date(frequency.to) };
      const postSources = [
        ...new Set(
          data.posts.filter((p) => inPeriod(p.publishedAt, window)).map((p) => p.dataSource),
        ),
      ];
      return {
        status: 'ok',
        value: frequency.postsPerWeek,
        comparable: comparable(frequency.postsPerWeek, source),
        sources: postSources.length ? postSources : [source],
        sampleSize: frequency.posts,
        sampleUnit: 'posts',
        sample: `${formatCount(frequency.posts)} posts in ${formatDecimal(frequency.weeks)} weeks`,
      };
    }
    case 'median_engagement': {
      const window = engagementWindow(period);
      const measured = data.posts.filter(
        (p) =>
          inPeriod(p.publishedAt, window) &&
          (!p.likes || p.likes.dataSource === source) &&
          (!p.comments || p.comments.dataSource === source),
      );
      const engagement = publicEngagement(measured);
      if (engagement.status !== 'ok') {
        return {
          ...unavailable(engagement.reason, engagement.detail),
          ...(engagement.excludedHidden ? { label: 'likes hidden by owner' } : {}),
        };
      }
      const hidden = engagement.excludedHidden
        ? `; ${engagement.excludedHidden} with hidden likes left out`
        : '';
      if (engagement.posts < MIN_POSTS_FOR_COMPARISON) {
        return unavailable(
          'too_few_posts',
          `Only ${engagement.posts} post${engagement.posts === 1 ? '' : 's'} measured at ${ENGAGEMENT_AGE_DAYS} days old${hidden}; at least ${MIN_POSTS_FOR_COMPARISON} are needed to compare.`,
        );
      }
      return {
        status: 'ok',
        value: engagement.median,
        comparable: comparable(engagement.median, engagement.dataSource),
        sources: [engagement.dataSource],
        sampleSize: engagement.posts,
        sampleUnit: 'posts',
        sample: `${engagement.posts} posts published ${formatPeriod(window)}, mean ${formatCount(engagement.mean)}${hidden}`,
      };
    }
    case 'followers': {
      const latest = latestFollowers(
        data.followers.filter((o) => o.dataSource === source && inPeriod(o.at, period)),
      );
      if (!latest) {
        return unavailable('no_observations', 'No follower count was observed in this period.');
      }
      return {
        status: 'ok',
        value: latest.value,
        comparable: comparable(latest.value, latest.dataSource),
        sources: [latest.dataSource],
        sampleSize: 1,
        sampleUnit: 'observation',
        sample: `observed ${formatDay(latest.at)}`,
        measuredAt: latest.at,
      };
    }
  }
}

/* -------------------------------------------------------------------------------------------
 * Rankings
 * ----------------------------------------------------------------------------------------- */

export type ExclusionReason = 'other_platform' | 'paused' | 'not_comparable' | 'unavailable';

export type RankedEntry = {
  rank: number;
  profile: ProfileRecord;
  value: number;
  measurement: Extract<Measurement, { status: 'ok' }>;
};

export type ExcludedEntry = {
  profile: ProfileRecord;
  reason: ExclusionReason;
  /** Short label for the reason, safe to show as-is. */
  label: string;
  detail: string;
};

export type Ranking = {
  metric: BenchmarkMetric;
  platformKey: string;
  period: Period;
  /** Engagement: the window of posts measured; otherwise the period itself. */
  measuredWindow: Period;
  source: DataSource;
  /** One sentence that states what the ranking is based on. */
  basis: string;
  ranked: RankedEntry[];
  excluded: ExcludedEntry[];
};

/**
 * Platforms present among the profiles, most profiles first. Rankings are made one platform
 * at a time: the derived metrics' comparability classes are platform-specific (see
 * METRICS.md §3), so even growth percentages aren't ranked across platforms.
 */
export function platformsOf(profiles: readonly ProfileRecord[]): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of profiles) counts.set(p.platformKey, (counts.get(p.platformKey) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function basisSentence(input: {
  metric: BenchmarkMetric;
  platformKey: string;
  period: Period;
  source: DataSource;
  setLabel: string;
}): string {
  const { metric, period } = input;
  const when =
    metric === 'median_engagement'
      ? `for posts published ${formatPeriod(engagementWindow(period))}`
      : formatPeriod(period);
  const extra =
    metric === 'median_engagement'
      ? `; profiles need at least ${MIN_POSTS_FOR_COMPARISON} measured posts`
      : metric === 'posts_per_week'
        ? '; only profiles whose post history covers the whole period'
        : '';
  return `Ranked by ${BENCHMARK_METRIC_INFO[metric].basis}, ${when}, ${DATA_SOURCE_LABELS[input.source]} data, ${platformName(input.platformKey)} only, ${input.setLabel}${extra}.`;
}

/**
 * Ranks profiles on one metric, on one platform, over one period. A profile is ranked only
 * with a value comparable with the others (same metric key, comparability class and data
 * source); everyone else is listed with the reason. A missing value is never ranked as 0.
 * Equal values share a rank (1, 2, 2, 4).
 */
export function rankProfiles(input: {
  metric: BenchmarkMetric;
  platformKey: string;
  data: readonly BenchmarkProfileData[];
  period: Period;
  source: DataSource;
  setLabel: string;
}): Ranking {
  const { metric, platformKey, period, source } = input;
  const info = BENCHMARK_METRIC_INFO[metric];
  const reference = comparableValue({
    platformKey,
    scope: info.scope,
    metricKey: info.metricKey,
    dataSource: source,
    value: null,
  });
  const candidates: Omit<RankedEntry, 'rank'>[] = [];
  const excluded: ExcludedEntry[] = [];

  for (const data of input.data) {
    const { profile } = data;
    if (profile.platformKey !== platformKey) {
      excluded.push({
        profile,
        reason: 'other_platform',
        label: `on ${platformName(profile.platformKey)}`,
        detail: `This ranking is ${platformName(platformKey)} only; numbers from different platforms are measured differently.`,
      });
      continue;
    }
    if (!profile.isActive) {
      excluded.push({
        profile,
        reason: 'paused',
        label: 'paused',
        detail: 'Monitoring is paused for this profile.',
      });
      continue;
    }
    const measurement = measure(metric, data, period, source);
    if (measurement.status !== 'ok') {
      excluded.push({
        profile,
        reason: 'unavailable',
        label: measurement.label ?? unavailableLabel(measurement),
        detail: measurement.detail,
      });
      continue;
    }
    const check = checkComparable(reference, measurement.comparable);
    if (!check.ok) {
      excluded.push({
        profile,
        reason: 'not_comparable',
        label: 'not comparable',
        detail: REFUSAL_LABELS[check.reason],
      });
      continue;
    }
    candidates.push({ profile, value: measurement.value, measurement });
  }

  candidates.sort((a, b) => b.value - a.value || a.profile.name.localeCompare(b.profile.name));
  const ranked: RankedEntry[] = [];
  candidates.forEach((entry, index) => {
    const previous = ranked[index - 1];
    const rank = previous && previous.value === entry.value ? previous.rank : index + 1;
    ranked.push({ ...entry, rank });
  });

  const order: Record<ExclusionReason, number> = {
    unavailable: 0,
    not_comparable: 1,
    paused: 2,
    other_platform: 3,
  };
  excluded.sort(
    (a, b) => order[a.reason] - order[b.reason] || a.profile.name.localeCompare(b.profile.name),
  );

  return {
    metric,
    platformKey,
    period,
    measuredWindow: metric === 'median_engagement' ? engagementWindow(period) : period,
    source,
    basis: basisSentence(input),
    ranked,
    excluded,
  };
}

const SHORT_UNAVAILABLE: Partial<Record<Unavailable['reason'], string>> = {
  no_observations: 'not observed in this period',
  not_enough_observations: 'not enough observations',
  no_baseline: 'no starting value',
  history_start_unknown: 'post history not loaded yet',
  history_starts_after_range: 'post history starts later',
  window_too_short: 'not enough post history',
  no_posts_at_age: 'no posts measured at 7 days',
  too_few_posts: 'too few posts measured',
};

function unavailableLabel(result: Unavailable): string {
  return SHORT_UNAVAILABLE[result.reason] ?? 'not available';
}

/* -------------------------------------------------------------------------------------------
 * Country vs country
 * ----------------------------------------------------------------------------------------- */

export type CountrySplit = 'own' | 'competitors' | 'all';

export type CountryRow = {
  /** null = profiles without a country. */
  countryCode: string | null;
  own: GroupSummary;
  competitors: GroupSummary;
  /** Every profile of the country in the set (own, competitors, industry, creators…). */
  all: GroupSummary;
};

const NO_COUNTRY = '—';

/**
 * Country vs country for one ranking: medians per country (so one large profile doesn't
 * dominate), with the number of profiles behind each and the number without a value. Uses
 * exactly the ranking's comparable values; profiles excluded for another platform, paused
 * or not comparable are left out, those without a value are counted as such.
 */
export function countryBenchmark(ranking: Ranking): CountryRow[] {
  const reference = comparableValue({
    platformKey: ranking.platformKey,
    scope: BENCHMARK_METRIC_INFO[ranking.metric].scope,
    metricKey: BENCHMARK_METRIC_INFO[ranking.metric].metricKey,
    dataSource: ranking.source,
    value: null,
  });
  const rows = [
    ...ranking.ranked.map((r) => ({ profile: r.profile, value: r.value as number | null })),
    ...ranking.excluded
      .filter((e) => e.reason === 'unavailable')
      .map((e) => ({ profile: e.profile, value: null })),
  ].map((r) => ({
    country: r.profile.countryCode ?? NO_COUNTRY,
    role: roleGroup(r.profile.businessRole),
    value: { ...reference, value: r.value },
  }));
  if (!rows.length) return [];

  const summarize = (filter: (role: string) => boolean) => {
    const result = summarizeGroups(
      rows.filter((r) => filter(r.role)).map((r) => ({ group: r.country, value: r.value })),
    );
    return new Map(
      (result.status === 'ok' ? result.groups : []).map((group) => [group.key, group]),
    );
  };
  const own = summarize((role) => role === 'owned');
  const competitors = summarize((role) => role === 'competitor');
  const all = summarize(() => true);
  const empty = (key: string): GroupSummary => ({
    key,
    median: null,
    profiles: 0,
    unavailable: 0,
  });

  return [...all.keys()]
    .map((key) => ({
      countryCode: key === NO_COUNTRY ? null : key,
      own: own.get(key) ?? empty(key),
      competitors: competitors.get(key) ?? empty(key),
      all: all.get(key)!,
    }))
    .sort((a, b) => {
      if (a.countryCode === null) return 1;
      if (b.countryCode === null) return -1;
      const am = a.all.median;
      const bm = b.all.median;
      if (am === null && bm !== null) return 1;
      if (bm === null && am !== null) return -1;
      return (bm ?? 0) - (am ?? 0) || a.countryCode.localeCompare(b.countryCode);
    });
}

/* -------------------------------------------------------------------------------------------
 * This period vs the previous period
 * ----------------------------------------------------------------------------------------- */

export type PeriodChange =
  | {
      status: 'compared';
      /** current − previous (percentage points for growth, as a fraction: 0.012 = 1.2 pp). */
      difference: number;
      /** (current − previous) / previous; null for growth rates and when previous is 0. */
      relative: number | null;
    }
  | {
      status: 'not_enough';
      /** Which side lacks a value. */
      missing: ('current' | 'previous')[];
    }
  | { status: 'not_comparable'; detail: string };

export type PeriodRow = {
  profile: ProfileRecord;
  current: Measurement;
  previous: Measurement;
  change: PeriodChange;
};

/**
 * One profile's value in this period and in the previous period of equal length, with the
 * sample behind each. When either side lacks enough observations the change isn't given.
 */
export function comparePeriods(input: {
  metric: BenchmarkMetric;
  data: BenchmarkProfileData;
  periods: { current: Period; previous: Period };
  source: DataSource;
}): PeriodRow {
  const current = measure(input.metric, input.data, input.periods.current, input.source);
  const previous = measure(input.metric, input.data, input.periods.previous, input.source);
  return {
    profile: input.data.profile,
    current,
    previous,
    change: periodChange(input.metric, current, previous),
  };
}

function periodChange(
  metric: BenchmarkMetric,
  current: Measurement,
  previous: Measurement,
): PeriodChange {
  const missing: ('current' | 'previous')[] = [];
  if (current.status !== 'ok') missing.push('current');
  if (previous.status !== 'ok') missing.push('previous');
  if (current.status !== 'ok' || previous.status !== 'ok') return { status: 'not_enough', missing };
  const comparison = compareValues(current.comparable, previous.comparable);
  if (comparison.status === 'refused') {
    return { status: 'not_comparable', detail: REFUSAL_LABELS[comparison.reason] };
  }
  if (comparison.status === 'unavailable') return { status: 'not_enough', missing };
  return {
    status: 'compared',
    difference: comparison.difference,
    relative:
      metric === 'follower_growth' || comparison.b === 0
        ? null
        : comparison.difference / comparison.b,
  };
}

export type PeriodGroupSummary = {
  key: string;
  label: string;
  /** Profiles of the group on the platform. */
  profiles: number;
  /** Profiles with a value in both periods; the medians use only these. */
  paired: number;
  currentMedian: number | null;
  previousMedian: number | null;
  /** Profiles lacking a value in one period or both. */
  notEnough: number;
};

/**
 * A group's median this period and last period, over the same profiles: only profiles with a
 * value in both periods count, so a change in who was measured doesn't read as a change.
 */
export function summarizePeriodGroup(
  key: string,
  label: string,
  rows: readonly PeriodRow[],
): PeriodGroupSummary {
  const paired = rows.filter((r) => r.change.status === 'compared');
  const values = (side: 'current' | 'previous') =>
    paired.flatMap((r) => {
      const m = r[side];
      return m.status === 'ok' ? [m.value] : [];
    });
  return {
    key,
    label,
    profiles: rows.length,
    paired: paired.length,
    currentMedian: median(values('current')),
    previousMedian: median(values('previous')),
    notEnough: rows.length - paired.length,
  };
}

/** "+1.2 pp" style difference for growth, a signed value otherwise. */
export function formatDifference(metric: BenchmarkMetric, difference: number): string {
  switch (metric) {
    case 'follower_growth': {
      const points = Math.round(difference * 1000) / 10;
      const sign = points > 0 ? '+' : points < 0 ? '−' : '±';
      return `${sign}${formatDecimal(Math.abs(points))} pp`;
    }
    case 'posts_per_week': {
      const sign = difference > 0 ? '+' : difference < 0 ? '−' : '±';
      return `${sign}${formatDecimal(Math.abs(difference))}`;
    }
    case 'median_engagement':
    case 'followers':
      return formatSignedCount(difference);
  }
}
