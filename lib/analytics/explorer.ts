import { BUSINESS_ROLE_LABELS, DATA_SOURCE_LABELS } from '@/lib/accounts/labels';
import { getMetric, METRIC_DEFINITIONS } from '@/lib/metrics/registry';
import {
  comparableValue,
  REFUSAL_LABELS,
  summarizeGroups,
  type ComparabilityRefusal,
  type ComparableValue,
} from './compare';
import { MEDIA_FORMAT_LABELS } from './content';
import { MIN_POSTS_FOR_COMPARISON, postEngagement } from './engagement';
import { formatCount, formatDecimal } from './format';
import { distinctNames, platformName } from './names';
import { formatPeriod, inPeriod } from './range';
import { mean } from './stats';
import type {
  BusinessRole,
  DataSource,
  MediaFormat,
  MetricAvailability,
  Period,
  PostRecord,
  ProfileRecord,
} from './types';

/* -------------------------------------------------------------------------------------------
 * Stored data
 * ----------------------------------------------------------------------------------------- */

/** The latest stored lifetime value of one post metric, per data source (post_metrics_latest). */
export type StoredPostMetric = {
  metricKey: string;
  value: number | null;
  availability: MetricAvailability;
  dataSource: DataSource;
};

/** One stored post with its profile, tags and latest metric values. */
export type ExplorerPost = {
  id: string;
  profile: ProfileRecord;
  publishedAt: string;
  mediaFormat: MediaFormat;
  permalink: string | null;
  caption: string | null;
  /** The post's own country, else its profile's. */
  countryCode: string | null;
  pillarId: string | null;
  campaignId: string | null;
  metrics: readonly StoredPostMetric[];
};

/* -------------------------------------------------------------------------------------------
 * Metrics and groupings the explorer offers
 * ----------------------------------------------------------------------------------------- */

/** Likes + comments, computed from the stored values (engagement.ts), never stored. */
export const PUBLIC_ENGAGEMENT = 'public_engagement';

/** Stored post metrics in dictionary order, then public engagement. */
export const EXPLORER_METRICS: readonly string[] = [
  ...METRIC_DEFINITIONS.filter((m) => m.appliesToPosts && !m.isDerived).map((m) => m.key),
  PUBLIC_ENGAGEMENT,
];

export const DEFAULT_EXPLORER_METRIC = 'likes';

export const COMPARE_BY = [
  'country',
  'profile',
  'platform',
  'format',
  'pillar',
  'campaign',
] as const;
export type CompareBy = (typeof COMPARE_BY)[number];

export const COMPARE_BY_LABELS: Record<CompareBy, string> = {
  country: 'Country',
  profile: 'Profile',
  platform: 'Platform',
  format: 'Format',
  pillar: 'Content pillar',
  campaign: 'Campaign',
};

/** Why a post has no value for the chosen metric. Never counted as 0. */
export type ExclusionReason = Exclude<MetricAvailability, 'available'> | 'not_stored';

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  not_stored: 'no stored value',
  hidden_by_owner: 'hidden by the owner',
  not_applicable: 'not applicable to the post',
  not_permitted: 'not shared by the platform',
  not_public: 'not public',
  pending: 'not reported yet',
  error: 'read failed',
};

export function metricLabel(key: string): string {
  return getMetric(key)?.label ?? key;
}

export function formatMetricValue(key: string, value: number): string {
  const unit = getMetric(key)?.unit;
  if (unit === 'percent') return `${formatDecimal(value * 100)}%`;
  if (unit === 'seconds') return `${formatDecimal(value)} s`;
  return Number.isInteger(value) ? formatCount(value) : formatDecimal(value);
}

/* -------------------------------------------------------------------------------------------
 * Filters
 * ----------------------------------------------------------------------------------------- */

export type ExplorerFilters = {
  /** null = every platform. */
  platform: string | null;
  country: string | null;
  role: BusinessRole | null;
  format: MediaFormat | null;
  pillar: string | null;
  campaign: string | null;
};

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

/**
 * Reads the filters from the URL. Unknown roles and formats are ignored; other values are
 * checked against what the posts actually carry by the caller.
 */
export function parseExplorerFilters(
  search: Record<string, string | string[] | undefined>,
): Omit<ExplorerFilters, 'platform'> & { platform: string } {
  const role = one(search.role);
  const format = one(search.format);
  return {
    platform: one(search.platform),
    country: one(search.country) || null,
    role: role in BUSINESS_ROLE_LABELS ? (role as BusinessRole) : null,
    format: format in MEDIA_FORMAT_LABELS ? (format as MediaFormat) : null,
    pillar: one(search.pillar) || null,
    campaign: one(search.campaign) || null,
  };
}

export function parseCompareBy(value: string | string[] | undefined): CompareBy {
  const raw = one(value);
  return (COMPARE_BY as readonly string[]).includes(raw) ? (raw as CompareBy) : 'country';
}

/** Posts published in the period that match every filter. */
export function filterPosts(
  posts: readonly ExplorerPost[],
  filters: ExplorerFilters,
  period: Period,
): ExplorerPost[] {
  return posts.filter(
    (post) =>
      inPeriod(post.publishedAt, period) &&
      (!filters.platform || post.profile.platformKey === filters.platform) &&
      (!filters.country || post.countryCode === filters.country) &&
      (!filters.role || post.profile.businessRole === filters.role) &&
      (!filters.format || post.mediaFormat === filters.format) &&
      (!filters.pillar || post.pillarId === filters.pillar) &&
      (!filters.campaign || post.campaignId === filters.campaign),
  );
}

/** Distinct values with post counts, largest first. */
export function countBy<T extends string>(
  posts: readonly ExplorerPost[],
  key: (post: ExplorerPost) => T | null,
): { key: T; count: number }[] {
  const counts = new Map<T, number>();
  for (const post of posts) {
    const value = key(post);
    if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ key: value, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/* -------------------------------------------------------------------------------------------
 * One post's value
 * ----------------------------------------------------------------------------------------- */

export type PostValue =
  | { status: 'ok'; value: number; comparable: ComparableValue }
  | { status: 'excluded'; reason: ExclusionReason };

function stored(post: ExplorerPost, metricKey: string, source: DataSource) {
  return post.metrics.find((m) => m.metricKey === metricKey && m.dataSource === source);
}

function excludedFor(metric: StoredPostMetric | undefined): ExclusionReason {
  if (!metric || metric.availability === 'available') return 'not_stored';
  return metric.availability;
}

/**
 * The post's latest stored value of one metric, of one data source, or why there is none.
 * Only values stored as `available` count; hidden, not-applicable and missing values are
 * excluded with their reason, never read as 0. Public engagement is likes + comments of the
 * same source (engagement.ts).
 */
export function postValue(post: ExplorerPost, metricKey: string, source: DataSource): PostValue {
  const comparable = (value: number) =>
    comparableValue({
      platformKey: post.profile.platformKey,
      scope: 'post',
      metricKey,
      dataSource: source,
      value,
    });

  if (metricKey === PUBLIC_ENGAGEMENT) {
    const likes = stored(post, 'likes', source);
    const comments = stored(post, 'comments', source);
    const record: Pick<PostRecord, 'likes' | 'comments'> = { likes, comments };
    const engagement = postEngagement(record as PostRecord);
    if (engagement.status === 'ok') {
      return { status: 'ok', value: engagement.value, comparable: comparable(engagement.value) };
    }
    if (engagement.status === 'hidden_by_owner') {
      return { status: 'excluded', reason: 'hidden_by_owner' };
    }
    const reason = excludedFor(likes);
    return { status: 'excluded', reason: reason === 'not_stored' ? excludedFor(comments) : reason };
  }

  const metric = stored(post, metricKey, source);
  if (!metric || metric.availability !== 'available' || metric.value === null) {
    return { status: 'excluded', reason: excludedFor(metric) };
  }
  return { status: 'ok', value: metric.value, comparable: comparable(metric.value) };
}

/* -------------------------------------------------------------------------------------------
 * Which metrics can be compared across the selected posts
 * ----------------------------------------------------------------------------------------- */

export type MetricOption = {
  key: string;
  label: string;
  /** Posts with an available value. */
  posts: number;
  /** True when every available value shares one comparability class. */
  comparable: boolean;
};

/** Metrics with at least one available value among the posts, in dictionary order. */
export function metricOptions(posts: readonly ExplorerPost[], source: DataSource): MetricOption[] {
  const options: MetricOption[] = [];
  for (const key of EXPLORER_METRICS) {
    const classes = new Set<string>();
    let count = 0;
    for (const post of posts) {
      const value = postValue(post, key, source);
      if (value.status !== 'ok') continue;
      count++;
      classes.add(value.comparable.comparabilityClass);
    }
    if (count) {
      options.push({ key, label: metricLabel(key), posts: count, comparable: classes.size === 1 });
    }
  }
  return options;
}

/* -------------------------------------------------------------------------------------------
 * The comparison
 * ----------------------------------------------------------------------------------------- */

export type ExampleEntry = { post: ExplorerPost; value: number };

export type ExplorerGroup = {
  key: string;
  label: string;
  /** For profile groups: the profile, so the UI can link to it. */
  profile?: ProfileRecord;
  /** Posts with a value. */
  posts: number;
  /** null when fewer than MIN_POSTS_FOR_COMPARISON posts have a value. */
  median: number | null;
  mean: number | null;
  /** Posts in this group left out, with the reason. */
  excluded: number;
  /** The three highest values. */
  top: ExampleEntry[];
};

export type ExclusionCount = { reason: ExclusionReason; posts: number };

export type Explorer =
  | { status: 'no_posts' }
  | { status: 'no_values'; posts: number; excluded: ExclusionCount[] }
  | {
      status: 'refused';
      reason: ComparabilityRefusal;
      detail: string;
      /** Platforms with values, so the UI can offer one at a time. */
      platforms: { key: string; count: number }[];
    }
  | {
      status: 'ok';
      groups: ExplorerGroup[];
      /** Posts with a value. */
      measured: number;
      excluded: ExclusionCount[];
      /** Posts with a value but nothing to group them by (no country, no pillar…). */
      ungrouped: number;
      basis: string;
      exclusionNote: string | null;
    };

export type ExplorerNames = {
  countries: ReadonlyMap<string, string>;
  pillars: ReadonlyMap<string, string>;
  campaigns: ReadonlyMap<string, string>;
};

function groupKey(post: ExplorerPost, compareBy: CompareBy): string | null {
  switch (compareBy) {
    case 'country':
      return post.countryCode;
    case 'profile':
      return post.profile.id;
    case 'platform':
      return post.profile.platformKey;
    case 'format':
      return post.mediaFormat;
    case 'pillar':
      return post.pillarId;
    case 'campaign':
      return post.campaignId;
  }
}

/** What a post lacks when it can't be put in a group: "posts with a value have …". */
export const UNGROUPED_LABELS: Record<CompareBy, string> = {
  country: 'no country set',
  profile: 'no profile',
  platform: 'no platform',
  format: 'no format',
  pillar: 'no pillar tag',
  campaign: 'no campaign tag',
};

function countReasons(reasons: readonly ExclusionReason[]): ExclusionCount[] {
  const counts = new Map<ExclusionReason, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts.entries()]
    .map(([reason, posts]) => ({ reason, posts }))
    .sort((a, b) => b.posts - a.posts || a.reason.localeCompare(b.reason));
}

/** "12 posts left out: 8 likes hidden by the owner, 4 no stored value." */
export function exclusionSentence(
  metricKey: string,
  excluded: readonly ExclusionCount[],
): string | null {
  const total = excluded.reduce((sum, e) => sum + e.posts, 0);
  if (!total) return null;
  const label = metricLabel(metricKey).toLowerCase();
  const parts = excluded.map((e) => `${formatCount(e.posts)} ${EXCLUSION_LABELS[e.reason]}`);
  return `${formatCount(total)} post${total === 1 ? '' : 's'} left out because ${label} ${total === 1 ? 'has' : 'have'} no value (${parts.join(', ')}); they are not counted as 0.`;
}

/**
 * What every number rests on: statistic, metric, value basis, period, posts, data source,
 * filters and grouping.
 */
export function basisSentence(input: {
  metricKey: string;
  period: Period;
  source: DataSource;
  measured: number;
  filters: ExplorerFilters;
  compareBy: CompareBy;
  names: ExplorerNames;
}): string {
  const { filters, names } = input;
  const scope: string[] = [];
  scope.push(filters.platform ? `${platformName(filters.platform)} only` : 'all platforms');
  if (filters.country) scope.push(names.countries.get(filters.country) ?? filters.country);
  if (filters.role) scope.push(BUSINESS_ROLE_LABELS[filters.role].toLowerCase());
  if (filters.format) scope.push(MEDIA_FORMAT_LABELS[filters.format].toLowerCase());
  if (filters.pillar) scope.push(`pillar “${names.pillars.get(filters.pillar) ?? '?'}”`);
  if (filters.campaign) scope.push(`campaign “${names.campaigns.get(filters.campaign) ?? '?'}”`);
  const label = metricLabel(input.metricKey).toLowerCase();
  const value =
    input.metricKey === PUBLIC_ENGAGEMENT
      ? 'likes + comments from the latest stored values'
      : 'the latest stored value';
  return `Median and mean ${label} per post (${value}), for ${formatCount(input.measured)} post${input.measured === 1 ? '' : 's'} published ${formatPeriod(input.period)} with a value, ${DATA_SOURCE_LABELS[input.source]} data, ${scope.join(', ')}, by ${COMPARE_BY_LABELS[input.compareBy].toLowerCase()}. Groups need at least ${MIN_POSTS_FOR_COMPARISON} posts for a median and mean.`;
}

/**
 * Median, mean, post count and top examples per group, for one metric and one data source.
 * Every value must be comparable with every other (same metric, comparability class and
 * source; compare.ts), otherwise the whole comparison is refused with the reason. Posts
 * without an available value are left out and counted by reason, never read as 0.
 */
export function buildExplorer(input: {
  posts: readonly ExplorerPost[];
  metricKey: string;
  source: DataSource;
  compareBy: CompareBy;
  period: Period;
  filters: ExplorerFilters;
  names: ExplorerNames;
}): Explorer {
  const { posts, metricKey, source, compareBy } = input;
  if (!posts.length) return { status: 'no_posts' };

  const measured: { post: ExplorerPost; value: number; comparable: ComparableValue }[] = [];
  const reasons: ExclusionReason[] = [];
  const excludedByGroup = new Map<string, number>();
  for (const post of posts) {
    const value = postValue(post, metricKey, source);
    if (value.status === 'ok') {
      measured.push({ post, value: value.value, comparable: value.comparable });
    } else {
      reasons.push(value.reason);
      const key = groupKey(post, compareBy);
      if (key !== null) excludedByGroup.set(key, (excludedByGroup.get(key) ?? 0) + 1);
    }
  }
  const excluded = countReasons(reasons);
  if (!measured.length) return { status: 'no_values', posts: posts.length, excluded };

  const grouped = measured.flatMap((m) => {
    const key = groupKey(m.post, compareBy);
    return key === null ? [] : [{ ...m, key }];
  });
  // Checks every measured value, grouped or not: one comparison never mixes classes.
  const summary = summarizeGroups(
    measured.map((m) => ({ group: groupKey(m.post, compareBy) ?? '', value: m.comparable })),
  );
  if (summary.status === 'refused') {
    return {
      status: 'refused',
      reason: summary.reason,
      detail: REFUSAL_LABELS[summary.reason],
      platforms: countBy(
        measured.map((m) => m.post),
        (post) => post.profile.platformKey,
      ),
    };
  }

  const profileNames = distinctNames([
    ...new Map(posts.map((p) => [p.profile.id, p.profile])).values(),
  ]);
  const labelOf = (key: string, post: ExplorerPost): string => {
    switch (compareBy) {
      case 'country':
        return input.names.countries.get(key) ?? key;
      case 'profile':
        return profileNames.get(key) ?? post.profile.name;
      case 'platform':
        return platformName(key);
      case 'format':
        return MEDIA_FORMAT_LABELS[key as MediaFormat] ?? key;
      case 'pillar':
        return input.names.pillars.get(key) ?? 'Unknown pillar';
      case 'campaign':
        return input.names.campaigns.get(key) ?? 'Unknown campaign';
    }
  };

  const byKey = new Map<string, typeof grouped>();
  for (const entry of grouped) {
    const list = byKey.get(entry.key) ?? [];
    list.push(entry);
    byKey.set(entry.key, list);
  }
  const medians = new Map(summary.groups.map((g) => [g.key, g.median]));
  const groups: ExplorerGroup[] = [...byKey.entries()].map(([key, entries]) => {
    const enough = entries.length >= MIN_POSTS_FOR_COMPARISON;
    const top = [...entries]
      .sort((a, b) => b.value - a.value || b.post.publishedAt.localeCompare(a.post.publishedAt))
      .slice(0, 3)
      .map(({ post, value }) => ({ post, value }));
    return {
      key,
      label: labelOf(key, entries[0]!.post),
      profile: compareBy === 'profile' ? entries[0]!.post.profile : undefined,
      posts: entries.length,
      median: enough ? (medians.get(key) ?? null) : null,
      mean: enough ? mean(entries.map((e) => e.value)) : null,
      excluded: excludedByGroup.get(key) ?? 0,
      top,
    };
  });
  // Groups without a single value are still listed, so they don't silently disappear.
  for (const [key, count] of excludedByGroup) {
    if (byKey.has(key)) continue;
    const post = posts.find((p) => groupKey(p, compareBy) === key)!;
    groups.push({
      key,
      label: labelOf(key, post),
      profile: compareBy === 'profile' ? post.profile : undefined,
      posts: 0,
      median: null,
      mean: null,
      excluded: count,
      top: [],
    });
  }
  groups.sort(
    (a, b) =>
      Number(b.median !== null) - Number(a.median !== null) ||
      (b.median ?? 0) - (a.median ?? 0) ||
      b.posts - a.posts ||
      a.label.localeCompare(b.label),
  );

  return {
    status: 'ok',
    groups,
    measured: measured.length,
    excluded,
    ungrouped: measured.length - grouped.length,
    basis: basisSentence({
      metricKey,
      period: input.period,
      source,
      measured: measured.length,
      filters: input.filters,
      compareBy,
      names: input.names,
    }),
    exclusionNote: exclusionSentence(metricKey, excluded),
  };
}

/* -------------------------------------------------------------------------------------------
 * The page
 * ----------------------------------------------------------------------------------------- */

export type ExplorerView = {
  source: DataSource;
  sources: DataSource[];
  filters: ExplorerFilters;
  /** The platform select's value: a platform key or 'all'. */
  platformParam: string;
  compareBy: CompareBy;
  compareOptions: CompareBy[];
  metricKey: string;
  /** Comparable metrics, plus the chosen one if it isn't. */
  metrics: MetricOption[];
  /** Metrics with values that can't be compared across the selected platforms. */
  notComparable: MetricOption[];
  options: {
    platforms: { key: string; count: number }[];
    countries: { key: string; count: number }[];
    formats: { key: MediaFormat; count: number }[];
    roles: { key: BusinessRole; count: number }[];
  };
  /** Posts published in the period that match the filters. */
  posts: ExplorerPost[];
  explorer: Explorer;
};

/**
 * Everything the Analytics page shows. Without a platform in the URL it opens on the platform
 * with the most posts, because most metrics are only comparable within one platform; 'all'
 * selects every platform. Filter values the posts don't carry are ignored.
 */
export function buildExplorerView(input: {
  search: Record<string, string | string[] | undefined>;
  posts: readonly ExplorerPost[];
  /** Sources with stored post values, preferred first. */
  sources: readonly DataSource[];
  period: Period;
  hasPillars: boolean;
  hasCampaigns: boolean;
  names: ExplorerNames;
}): ExplorerView {
  const { search, period } = input;
  const requestedSource = one(search.source);
  const source = (input.sources.find((s) => s === requestedSource) ?? input.sources[0]) as
    DataSource | undefined;
  const parsed = parseExplorerFilters(search);
  const inRange = input.posts.filter((post) => inPeriod(post.publishedAt, period));

  const platforms = countBy(inRange, (post) => post.profile.platformKey);
  const platform =
    parsed.platform === 'all'
      ? null
      : (platforms.find((p) => p.key === parsed.platform)?.key ?? platforms[0]?.key ?? null);
  const countries = countBy(inRange, (post) => post.countryCode);
  const formats = countBy(inRange, (post) => post.mediaFormat);
  const roles = countBy(inRange, (post) => post.profile.businessRole);
  const filters: ExplorerFilters = {
    platform,
    country: countries.some((c) => c.key === parsed.country) ? parsed.country : null,
    role: roles.some((r) => r.key === parsed.role) ? parsed.role : null,
    format: formats.some((f) => f.key === parsed.format) ? parsed.format : null,
    pillar:
      input.hasPillars && parsed.pillar && input.names.pillars.has(parsed.pillar)
        ? parsed.pillar
        : null,
    campaign:
      input.hasCampaigns && parsed.campaign && input.names.campaigns.has(parsed.campaign)
        ? parsed.campaign
        : null,
  };
  const compareOptions = COMPARE_BY.filter(
    (key) => (key !== 'pillar' || input.hasPillars) && (key !== 'campaign' || input.hasCampaigns),
  );
  const requestedCompare = parseCompareBy(search.compare);
  const compareBy = compareOptions.includes(requestedCompare) ? requestedCompare : 'country';

  const posts = filterPosts(inRange, filters, period);
  const all = source ? metricOptions(posts, source) : [];
  const requestedMetric = one(search.metric);
  const chosen =
    all.find((m) => m.key === requestedMetric) ??
    all.find((m) => m.key === DEFAULT_EXPLORER_METRIC && m.comparable) ??
    all.find((m) => m.comparable) ??
    all[0];
  const metricKey = chosen?.key ?? DEFAULT_EXPLORER_METRIC;

  return {
    source: source ?? 'live_public',
    sources: [...input.sources],
    filters,
    platformParam: platform ?? 'all',
    compareBy,
    compareOptions,
    metricKey,
    metrics: all.filter((m) => m.comparable || m.key === metricKey),
    notComparable: all.filter((m) => !m.comparable),
    options: { platforms, countries, formats, roles },
    posts,
    explorer:
      source && chosen
        ? buildExplorer({
            posts,
            metricKey,
            source,
            compareBy,
            period,
            filters,
            names: input.names,
          })
        : posts.length
          ? {
              status: 'no_values',
              posts: posts.length,
              excluded: [{ reason: 'not_stored', posts: posts.length }],
            }
          : { status: 'no_posts' },
  };
}

/** The explorer's URL with the current choices, some replaced. Empty values are left out. */
export function explorerHref(
  orgSlug: string,
  current: Record<string, string | null | undefined>,
  changes: Record<string, string | null> = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...changes })) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return `/${orgSlug}/analytics${query ? `?${query}` : ''}`;
}

/** The URL parameters that reproduce a view. */
export function viewParams(view: ExplorerView, days: number): Record<string, string | null> {
  return {
    range: String(days),
    platform: view.platformParam,
    country: view.filters.country,
    role: view.filters.role,
    format: view.filters.format,
    pillar: view.filters.pillar,
    campaign: view.filters.campaign,
    compare: view.compareBy,
    metric: view.metricKey,
    source: view.sources.length > 1 ? view.source : null,
  };
}
