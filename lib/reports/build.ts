import type { BenchmarkProfileData } from '@/lib/analytics/benchmark';
import {
  engagementWindow,
  formatBenchmarkValue,
  platformsOf,
  rankProfiles,
} from '@/lib/analytics/benchmark';
import { roleGroup } from '@/lib/analytics/compare';
import { MEDIA_FORMAT_LABELS } from '@/lib/analytics/content';
import { MIN_POSTS_FOR_COMPARISON, postEngagement } from '@/lib/analytics/engagement';
import { formatCount, formatSignedCount } from '@/lib/analytics/format';
import { postingFrequency } from '@/lib/analytics/frequency';
import { observedGrowth } from '@/lib/analytics/growth';
import { platformName } from '@/lib/analytics/names';
import { inPeriod } from '@/lib/analytics/range';
import { median } from '@/lib/analytics/stats';
import type { DataSource, Period, ProfileRecord } from '@/lib/analytics/types';
import {
  REPORT_SNAPSHOT_VERSION,
  type ReportAction,
  type ReportInsight,
  type ReportKpi,
  type ReportPost,
  type ReportRanking,
  type ReportSnapshot,
  type ReportStrategy,
  type ReportWeek,
} from './types';

// Builds the weekly report from loaded data. Pure: everything it needs is passed in, so the
// same input always gives the same snapshot. Numbers come from lib/analytics; the summary
// sentences are fixed wording filled with those numbers.

export const TOP_CONTENT = 5;
export const MAX_RANKED_ROWS = 10;
const KEY_INSIGHTS = 3;
const ROLE = { owned: 'own', competitor: 'competitor', other: 'other' } as const;
const MAX_ACTIONS = 3;

const OPPORTUNITY_KINDS = new Set([
  'format_winner',
  'competitor_format',
  'topic_gap',
  'standout_post',
]);
const RISK_KINDS = new Set(['format_loser', 'pillar_gap']);

export type WeeklyReportInput = {
  orgName: string;
  isDemo: boolean;
  source: DataSource;
  timeZone: string;
  week: ReportWeek;
  previousWeek: ReportWeek;
  period: Period;
  previousPeriod: Period;
  profiles: readonly ProfileRecord[];
  data: ReadonlyMap<string, BenchmarkProfileData>;
  names: ReadonlyMap<string, string>;
  /** Content items marked published in Scopie, and review decisions, per week. */
  content: {
    published: number;
    previousPublished: number;
    reviews: number;
    previousReviews: number;
  };
  strategies: ReportStrategy[];
  analysis: {
    meta: NonNullable<ReportSnapshot['analysis']>;
    insights: ReportInsight[];
    actions: ReportAction[];
  } | null;
  /** Notes from loading (e.g. why no analysis could be made). */
  notes?: string[];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Measured = { value: number | null; counted: number; total: number; why: string | null };

function sumOverProfiles(
  profiles: readonly ProfileRecord[],
  measure: (profile: ProfileRecord) => number | null,
  why: string,
): Measured {
  let value = 0;
  let counted = 0;
  for (const profile of profiles) {
    const result = measure(profile);
    if (result === null) continue;
    value += result;
    counted += 1;
  }
  return counted
    ? { value, counted, total: profiles.length, why: null }
    : { value: null, counted, total: profiles.length, why };
}

function kpi(
  key: ReportKpi['key'],
  label: string,
  current: Measured,
  previous: Measured,
  format: (value: number) => string,
  basis: string,
): ReportKpi {
  const change =
    current.value !== null && previous.value !== null
      ? `${formatSignedCount(current.value - previous.value)} on the week before`
      : null;
  return {
    key,
    label,
    value: current.value,
    display: current.value === null ? 'N/A' : format(current.value),
    previous: previous.value,
    previousDisplay: previous.value === null ? 'N/A' : format(previous.value),
    change,
    basis,
    unavailable: current.value === null ? current.why : null,
  };
}

function countKpi(
  key: ReportKpi['key'],
  label: string,
  current: number,
  previous: number,
  basis: string,
): ReportKpi {
  const all = (value: number): Measured => ({ value, counted: 1, total: 1, why: null });
  return kpi(key, label, all(current), all(previous), formatCount, basis);
}

function engagementOf(
  own: readonly ProfileRecord[],
  data: WeeklyReportInput['data'],
  period: Period,
): Measured & { posts: number } {
  const window = engagementWindow(period);
  const values = own.flatMap((profile) =>
    (data.get(profile.id)?.posts ?? []).flatMap((post) => {
      if (!inPeriod(post.publishedAt, window)) return [];
      const engagement = postEngagement(post);
      return engagement.status === 'ok' ? [engagement.value] : [];
    }),
  );
  if (values.length < MIN_POSTS_FOR_COMPARISON) {
    return {
      value: null,
      counted: 0,
      total: own.length,
      posts: values.length,
      why: `Only ${plural(values.length, 'post')} measured at 7 days old; ${MIN_POSTS_FOR_COMPARISON} are needed.`,
    };
  }
  return {
    value: median(values)!,
    counted: own.length,
    total: own.length,
    posts: values.length,
    why: null,
  };
}

function ranking(
  input: WeeklyReportInput,
  profiles: readonly ProfileRecord[],
  setLabel: string,
): ReportRanking[] {
  return platformsOf(profiles).flatMap(({ key }) => {
    const data = profiles
      .filter((p) => p.platformKey === key)
      .map((p) => input.data.get(p.id))
      .filter((d): d is BenchmarkProfileData => d !== undefined);
    const result = rankProfiles({
      metric: 'follower_growth',
      platformKey: key,
      data,
      period: input.period,
      source: input.source,
      setLabel,
    });
    if (!result.ranked.length && !result.excluded.length) return [];
    return [
      {
        platformKey: key,
        platform: platformName(key),
        basis: result.basis,
        rows: result.ranked.slice(0, MAX_RANKED_ROWS).map((entry) => ({
          rank: entry.rank,
          accountId: entry.profile.id,
          name: input.names.get(entry.profile.id) ?? entry.profile.name,
          countryCode: entry.profile.countryCode,
          role: ROLE[roleGroup(entry.profile.businessRole)],
          display: formatBenchmarkValue('follower_growth', entry.value),
          sample: entry.measurement.sample,
        })),
        notRanked: result.excluded
          .filter((entry) => entry.reason !== 'other_platform')
          .map((entry) => ({
            name: input.names.get(entry.profile.id) ?? entry.profile.name,
            reason: entry.label,
          })),
      },
    ];
  });
}

function topContent(input: WeeklyReportInput, own: readonly ProfileRecord[]): ReportPost[] {
  const window = engagementWindow(input.period);
  return own
    .flatMap((profile) =>
      (input.data.get(profile.id)?.posts ?? []).flatMap((post) => {
        if (!inPeriod(post.publishedAt, window)) return [];
        const engagement = postEngagement(post);
        if (engagement.status !== 'ok') return [];
        return [
          {
            accountId: profile.id,
            profile: input.names.get(profile.id) ?? profile.name,
            platform: platformName(profile.platformKey),
            format: MEDIA_FORMAT_LABELS[post.mediaFormat],
            publishedAt: post.publishedAt,
            engagement: engagement.value,
            display: formatCount(engagement.value),
            permalink: post.permalink,
          },
        ];
      }),
    )
    .sort((a, b) => b.engagement - a.engagement || b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, TOP_CONTENT);
}

export function buildWeeklySnapshot(input: WeeklyReportInput): ReportSnapshot {
  const active = input.profiles.filter((p) => p.isActive);
  const own = active.filter((p) => p.businessRole === 'owned');
  const competitors = active.filter((p) => p.businessRole === 'competitor');
  const notes = [...(input.notes ?? [])];

  const growth = (period: Period) =>
    sumOverProfiles(
      own,
      (profile) => {
        const result = observedGrowth(input.data.get(profile.id)?.followers ?? [], period);
        return result.status === 'ok' ? result.change : null;
      },
      'No own profile has two follower observations a day apart in this week.',
    );
  const posting = (period: Period) =>
    sumOverProfiles(
      own,
      (profile) => {
        const result = postingFrequency({
          publishedAt: (input.data.get(profile.id)?.posts ?? []).map((p) => p.publishedAt),
          earliestPostAt: profile.earliestPostAt,
          period,
          observedUntil: profile.lastObservedAt,
        });
        return result.status === 'ok' ? result.posts : null;
      },
      "No own profile's post history covers this week.",
    );

  const followers = growth(input.period);
  const posts = posting(input.period);
  const engagement = engagementOf(own, input.data, input.period);
  const previousEngagement = engagementOf(own, input.data, input.previousPeriod);
  const kpis: ReportKpi[] = [
    kpi(
      'followers_gained',
      'Followers gained',
      followers,
      growth(input.previousPeriod),
      formatSignedCount,
      `Sum over ${followers.counted} of ${plural(followers.total, 'own profile')}: last follower count observed in the week minus the first.`,
    ),
    kpi(
      'posts_published',
      'Posts published',
      posts,
      posting(input.previousPeriod),
      formatCount,
      `Posts on ${posts.counted} of ${plural(posts.total, 'own profile')} whose post history covers the week.`,
    ),
    {
      ...kpi(
        'median_engagement',
        'Median likes + comments',
        engagement,
        previousEngagement,
        formatCount,
        `Median per post at 7 days old, over ${plural(engagement.posts, 'post')} on your profiles published the week before.`,
      ),
      change: null,
    },
    countKpi(
      'content_published',
      'Content published in Scopie',
      input.content.published,
      input.content.previousPublished,
      'Content items marked published in Scopie during the week.',
    ),
    countKpi(
      'reviews',
      'Review decisions',
      input.content.reviews,
      input.content.previousReviews,
      'Approvals, change requests and rejections made in Scopie during the week.',
    ),
  ];

  const markets = ranking(input, own, 'your profiles');
  const competitorWatch = competitors.length
    ? ranking(input, [...own, ...competitors], 'your profiles and competitors')
    : [];
  if (!own.length) notes.push('There are no active own profiles, so there are no market numbers.');
  if (!competitors.length)
    notes.push('No competitor profiles are tracked, so there is no competitor watch.');

  const insights = input.analysis?.insights ?? [];
  const key = insights.slice(0, KEY_INSIGHTS);
  const rest = insights.slice(KEY_INSIGHTS);
  const actions = (input.analysis?.actions ?? []).slice(0, MAX_ACTIONS);

  const summary: string[] = [];
  summary.push(
    followers.value === null
      ? `Follower growth couldn't be measured this week: ${followers.why!.toLowerCase()}`
      : `Your profiles gained ${formatSignedCount(followers.value)} followers (${followers.counted} of ${plural(followers.total, 'profile')} measured)${kpis[0]!.previous !== null ? `, against ${kpis[0]!.previousDisplay} the week before` : ''}.`,
  );
  if (posts.value !== null) {
    summary.push(
      `They published ${plural(posts.value, 'post')}${kpis[1]!.previous !== null ? `, against ${kpis[1]!.previousDisplay} the week before` : ''}.`,
    );
  }
  const leader = markets[0]?.rows[0];
  if (leader) {
    summary.push(`${leader.name} grew fastest on ${markets[0]!.platform} (${leader.display}).`);
  }
  if (input.analysis) {
    summary.push(
      `The analysis found ${plural(insights.length, 'insight')} and ${plural(input.analysis.actions.length, 'recommended action')}; the main ones are below.`,
    );
  } else {
    notes.push('No analysis could be made for this report, so there are no insights or actions.');
  }

  return {
    version: REPORT_SNAPSHOT_VERSION,
    orgName: input.orgName,
    isDemo: input.isDemo,
    dataSource: input.source,
    timeZone: input.timeZone,
    week: input.week,
    previousWeek: input.previousWeek,
    summary,
    kpis,
    markets,
    competitors: competitorWatch,
    topContent: topContent(input, own),
    strategies: input.strategies,
    insights: {
      key,
      opportunities: rest.filter((i) => OPPORTUNITY_KINDS.has(i.kind)),
      risks: rest.filter((i) => RISK_KINDS.has(i.kind)),
    },
    actions,
    analysis: input.analysis?.meta ?? null,
    notes,
  };
}
