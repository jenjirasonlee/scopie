import {
  comparableValue,
  comparisonSource,
  roleGroup,
  summarizeGroups,
  type GroupSummary,
} from './compare';
import { formatMix, hashtagCounts, topPosts, type FormatMix, type TopPost } from './content';
import {
  ENGAGEMENT_AGE_DAYS,
  MIN_POSTS_FOR_COMPARISON,
  publicEngagement,
  type Engagement,
} from './engagement';
import { historyCovers, postingFrequency, type Frequency } from './frequency';
import { latestFollowers, observedGrowth, type Growth } from './growth';
import { generateInsights, type Insight, type PeriodStats } from './insights';
import { DAY_MS, inPeriod, periodsFor, shiftPeriod } from './range';
import type {
  AccessType,
  BusinessRole,
  DataSource,
  FollowerObservation,
  Period,
  PostRecord,
  ProfileRecord,
  ProfileSnapshotRecord,
} from './types';

export type DashboardInput = {
  orgSlug: string;
  isDemoOrg: boolean;
  now: Date;
  days: number;
  /** Every profile in the organization, active or not. */
  profiles: ProfileRecord[];
  /** Follower observations by profile id, already filtered to the comparison source. */
  followers: Map<string, FollowerObservation[]>;
  /** Posts published since the start of the previous engagement window. */
  posts: PostRecord[];
  snapshots: ProfileSnapshotRecord[];
};

export type ProfileRow = {
  profile: ProfileRecord;
  latestFollowers: { at: string; value: number; dataSource: DataSource } | null;
  growth: Growth;
  frequency: Frequency;
  engagement: Engagement;
  formats: FormatMix;
  current: PeriodStats;
  previous: PeriodStats;
};

export type TrendSeries = {
  profile: ProfileRecord;
  points: { at: string; value: number; change: number }[];
};

export type WeeklyBucket = {
  start: string;
  end: string;
  groups: Record<
    'owned' | 'competitor' | 'other',
    { perProfile: number | null; posts: number; profiles: number }
  >;
};

export type DashboardModel = {
  source: DataSource;
  periods: { current: Period; previous: Period };
  engagementWindow: Period;
  tiles: {
    active: number;
    inactive: number;
    byRole: Partial<Record<BusinessRole, number>>;
    byAccess: Partial<Record<AccessType, number>>;
    observedInPeriod: number;
  };
  rows: ProfileRow[];
  topGrowing: ProfileRow[];
  growthMissing: ProfileRow[];
  topEngagement: ProfileRow[];
  engagementTooFew: ProfileRow[];
  frequencyRanked: ProfileRow[];
  topPosts: TopPost[];
  hiddenLikesPosts: number;
  hashtags: { tag: string; posts: number }[];
  trend: { series: TrendSeries[]; totalEligible: number };
  weekly: { platformKey: string | null; buckets: WeeklyBucket[] };
  groups: {
    platformKey: string;
    growth: GroupSummary[];
    frequency: GroupSummary[];
    engagement: GroupSummary[];
  }[];
  countries: { platformKey: string; engagement: GroupSummary[]; growth: GroupSummary[] }[];
  insights: Insight[];
  hasAnyObservation: boolean;
};

const MAX_TREND_SERIES = 6;

export function buildDashboard(input: DashboardInput): DashboardModel {
  const source = comparisonSource(input.isDemoOrg);
  const periods = periodsFor(input.now, input.days);
  const engagementWindow = shiftPeriod(periods.current, ENGAGEMENT_AGE_DAYS);
  const previousEngagementWindow = shiftPeriod(periods.previous, ENGAGEMENT_AGE_DAYS);
  const active = input.profiles.filter((p) => p.isActive);

  const postsByAccount = new Map<string, PostRecord[]>();
  for (const post of input.posts) {
    const list = postsByAccount.get(post.accountId) ?? [];
    list.push(post);
    postsByAccount.set(post.accountId, list);
  }

  const stats = (
    profile: ProfileRecord,
    period: Period,
    window: Period,
    clip: boolean,
  ): PeriodStats => {
    const posts = postsByAccount.get(profile.id) ?? [];
    const published = posts.filter((p) => inPeriod(p.publishedAt, period));
    const measured = posts.filter((p) => inPeriod(p.publishedAt, window));
    return {
      growth: observedGrowth(input.followers.get(profile.id) ?? [], period),
      frequency: postingFrequency({
        publishedAt: posts.map((p) => p.publishedAt),
        earliestPostAt: profile.earliestPostAt,
        observedUntil: profile.lastObservedAt,
        period,
        clip,
      }),
      engagement: publicEngagement(measured),
      published,
      measured,
    };
  };

  const rows: ProfileRow[] = active.map((profile) => {
    const current = stats(profile, periods.current, engagementWindow, true);
    // Period-over-period statements only use complete history (no clipping).
    const currentStrict = {
      ...current,
      frequency: stats(profile, periods.current, engagementWindow, false).frequency,
    };
    const previous = stats(profile, periods.previous, previousEngagementWindow, false);
    return {
      profile,
      latestFollowers: latestFollowers(input.followers.get(profile.id) ?? []),
      growth: current.growth,
      frequency: current.frequency,
      engagement: current.engagement,
      formats: formatMix(current.published),
      current: currentStrict,
      previous,
    };
  });

  const byRole: Partial<Record<BusinessRole, number>> = {};
  const byAccess: Partial<Record<AccessType, number>> = {};
  for (const p of active) {
    byRole[p.businessRole] = (byRole[p.businessRole] ?? 0) + 1;
    byAccess[p.accessType] = (byAccess[p.accessType] ?? 0) + 1;
  }

  const growthOk = rows.filter(
    (r): r is ProfileRow & { growth: Extract<Growth, { status: 'ok' }> } =>
      r.growth.status === 'ok' && r.growth.rate !== null,
  );
  const topGrowing = [...growthOk].sort((a, b) => b.growth.rate! - a.growth.rate!).slice(0, 5);
  const growthMissing = rows.filter((r) => r.growth.status !== 'ok' || r.growth.rate === null);

  const engagementEligible = rows.filter(
    (r) => r.engagement.status === 'ok' && r.engagement.posts >= MIN_POSTS_FOR_COMPARISON,
  );
  const topEngagement = engagementEligible
    .sort((a, b) => okMedian(b.engagement) - okMedian(a.engagement))
    .slice(0, 5);
  const engagementTooFew = rows.filter(
    (r) => !(r.engagement.status === 'ok' && r.engagement.posts >= MIN_POSTS_FOR_COMPARISON),
  );

  const frequencyRanked = [...rows].sort((a, b) => {
    const fa = a.frequency.status === 'ok' ? a.frequency.postsPerWeek : -1;
    const fb = b.frequency.status === 'ok' ? b.frequency.postsPerWeek : -1;
    return fb - fa || a.profile.name.localeCompare(b.profile.name);
  });

  const measuredNow = rows.flatMap((r) => r.current.measured);
  const publishedNow = rows.flatMap((r) => r.current.published);

  return {
    source,
    periods,
    engagementWindow,
    tiles: {
      active: active.length,
      inactive: input.profiles.length - active.length,
      byRole,
      byAccess,
      observedInPeriod: rows.filter((r) =>
        (input.followers.get(r.profile.id) ?? []).some((o) => inPeriod(o.at, periods.current)),
      ).length,
    },
    rows,
    topGrowing,
    growthMissing,
    topEngagement,
    engagementTooFew,
    frequencyRanked,
    topPosts: topPosts(measuredNow, 5),
    hiddenLikesPosts: measuredNow.filter((p) => p.likes?.availability === 'hidden_by_owner').length,
    hashtags: hashtagCounts(publishedNow, 12),
    trend: followerTrend(rows, input.followers, periods.current),
    weekly: weeklyPosts(rows, postsByAccount, periods.current, input.days),
    groups: roleGroups(rows, source),
    countries: countryGroups(rows, source),
    insights: generateInsights({
      orgSlug: input.orgSlug,
      source,
      periods,
      profiles: rows.map((r) => ({
        profile: r.profile,
        current: r.current,
        previous: r.previous,
        snapshots: input.snapshots.filter(
          (s) => s.accountId === r.profile.id && s.dataSource === source,
        ),
      })),
    }),
    hasAnyObservation:
      [...input.followers.values()].some((list) => list.length > 0) || input.posts.length > 0,
  };
}

function okMedian(e: Engagement): number {
  return e.status === 'ok' ? e.median : -1;
}

/**
 * Follower trend: each profile's observed counts in the period, as change since its first
 * observation in the period, so profiles of different sizes share one axis. Only profiles
 * with at least two observations; no points are interpolated.
 */
function followerTrend(
  rows: ProfileRow[],
  followers: Map<string, FollowerObservation[]>,
  period: Period,
): DashboardModel['trend'] {
  const eligible = rows
    .filter((r) => r.growth.status === 'ok' && r.growth.first.value > 0)
    .map((r) => {
      const points = (followers.get(r.profile.id) ?? [])
        .filter((o) => o.value !== null && o.availability === 'available' && inPeriod(o.at, period))
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      const first = points[0]!.value!;
      return {
        profile: r.profile,
        points: points.map((o) => ({
          at: o.at,
          value: o.value!,
          change: (o.value! - first) / first,
        })),
      };
    });
  // Up to half own profiles, the rest other profiles, largest audiences first; then
  // alphabetical, so colours follow names rather than rank.
  const bySize = (a: TrendSeries, b: TrendSeries) =>
    b.points[b.points.length - 1]!.value - a.points[a.points.length - 1]!.value ||
    a.profile.name.localeCompare(b.profile.name);
  const own = eligible.filter((s) => s.profile.businessRole === 'owned').sort(bySize);
  const others = eligible.filter((s) => s.profile.businessRole !== 'owned').sort(bySize);
  const ownCount = Math.min(
    own.length,
    Math.max(MAX_TREND_SERIES / 2, MAX_TREND_SERIES - others.length),
  );
  const chosen = [...own.slice(0, ownCount), ...others.slice(0, MAX_TREND_SERIES - ownCount)].sort(
    (a, b) =>
      a.profile.name.localeCompare(b.profile.name) ||
      a.profile.platformKey.localeCompare(b.profile.platformKey),
  );
  return { series: chosen, totalEligible: eligible.length };
}

/**
 * Posts per week, as the average per profile in each group. A profile counts in a week only
 * when its post history covers that whole week, so missing history never reads as "no
 * posts". Limited to one platform, because post counts are compared within a platform.
 */
function weeklyPosts(
  rows: ProfileRow[],
  postsByAccount: Map<string, PostRecord[]>,
  period: Period,
  days: number,
): DashboardModel['weekly'] {
  const platformCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.profile.earliestPostAt) {
      platformCounts.set(
        r.profile.platformKey,
        (platformCounts.get(r.profile.platformKey) ?? 0) + 1,
      );
    }
  }
  const platformKey =
    [...platformCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
    null;
  if (!platformKey) return { platformKey: null, buckets: [] };
  const weeks = Math.max(1, Math.floor(days / 7));
  const end = period.end.getTime();
  const buckets: WeeklyBucket[] = [];
  for (let i = weeks; i >= 1; i--) {
    const bucket: Period = {
      start: new Date(end - i * 7 * DAY_MS),
      end: new Date(end - (i - 1) * 7 * DAY_MS),
    };
    const groups = {
      owned: { perProfile: null as number | null, posts: 0, profiles: 0 },
      competitor: { perProfile: null as number | null, posts: 0, profiles: 0 },
      other: { perProfile: null as number | null, posts: 0, profiles: 0 },
    };
    for (const r of rows) {
      if (r.profile.platformKey !== platformKey) continue;
      if (!historyCovers(r.profile.earliestPostAt, bucket, r.profile.lastObservedAt)) continue;
      const group = groups[roleGroup(r.profile.businessRole)];
      group.profiles++;
      group.posts += (postsByAccount.get(r.profile.id) ?? []).filter((p) =>
        inPeriod(p.publishedAt, bucket),
      ).length;
    }
    for (const group of Object.values(groups)) {
      group.perProfile = group.profiles ? group.posts / group.profiles : null;
    }
    buckets.push({ start: bucket.start.toISOString(), end: bucket.end.toISOString(), groups });
  }
  return { platformKey, buckets };
}

function rowValues(r: ProfileRow, source: DataSource) {
  const platformKey = r.profile.platformKey;
  return {
    growth: comparableValue({
      platformKey,
      scope: 'account',
      metricKey: 'follower_growth_rate',
      dataSource: r.growth.status === 'ok' ? r.growth.dataSource : source,
      value: r.growth.status === 'ok' ? r.growth.rate : null,
    }),
    frequency: comparableValue({
      platformKey,
      scope: 'account',
      metricKey: 'posts_published',
      dataSource: source,
      value: r.frequency.status === 'ok' ? r.frequency.postsPerWeek : null,
    }),
    engagement: comparableValue({
      platformKey,
      scope: 'post',
      metricKey: 'public_engagement',
      dataSource: r.engagement.status === 'ok' ? r.engagement.dataSource : source,
      value:
        r.engagement.status === 'ok' && r.engagement.posts >= MIN_POSTS_FOR_COMPARISON
          ? r.engagement.median
          : null,
    }),
  };
}

function summarize(
  rows: { group: string; value: ReturnType<typeof comparableValue> }[],
): GroupSummary[] {
  const result = summarizeGroups(rows);
  return result.status === 'ok' ? result.groups : [];
}

/** Own profiles vs competitors vs others, per platform (medians). */
function roleGroups(rows: ProfileRow[], source: DataSource): DashboardModel['groups'] {
  return byPlatform(rows).map(([platformKey, list]) => {
    const values = list.map((r) => ({
      group: roleGroup(r.profile.businessRole),
      ...rowValues(r, source),
    }));
    return {
      platformKey,
      growth: summarize(values.map((v) => ({ group: v.group, value: v.growth }))),
      frequency: summarize(values.map((v) => ({ group: v.group, value: v.frequency }))),
      engagement: summarize(values.map((v) => ({ group: v.group, value: v.engagement }))),
    };
  });
}

/** Country vs country, per platform (medians, so one large profile doesn't dominate). */
function countryGroups(rows: ProfileRow[], source: DataSource): DashboardModel['countries'] {
  return byPlatform(rows).map(([platformKey, list]) => {
    const values = list.map((r) => ({
      group: r.profile.countryCode ?? '—',
      ...rowValues(r, source),
    }));
    return {
      platformKey,
      growth: summarize(values.map((v) => ({ group: v.group, value: v.growth }))),
      engagement: summarize(values.map((v) => ({ group: v.group, value: v.engagement }))),
    };
  });
}

function byPlatform(rows: ProfileRow[]): [string, ProfileRow[]][] {
  const map = new Map<string, ProfileRow[]>();
  for (const r of rows) {
    const list = map.get(r.profile.platformKey) ?? [];
    list.push(r);
    map.set(r.profile.platformKey, list);
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}
