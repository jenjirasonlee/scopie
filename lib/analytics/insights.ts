import { distinctNames, platformName } from './names';
import { formatMix, MEDIA_FORMAT_LABELS, topPosts } from './content';
import { MIN_POSTS_FOR_COMPARISON, type Engagement } from './engagement';
import { formatCount, formatDecimal, formatShare, formatSignedPercent } from './format';
import type { Frequency } from './frequency';
import type { Growth } from './growth';
import { formatDay, formatPeriod, inPeriod } from './range';
import { median, relativeChange } from './stats';
import type { DataSource, Period, PostRecord, ProfileRecord, ProfileSnapshotRecord } from './types';

/**
 * "What changed?": deterministic, rule-based statements over two adjacent periods. Each one
 * carries its evidence (numbers, dates, sample sizes) and a link to the data. Wording is
 * strictly descriptive: things happened in the same period, never "because".
 */

export type InsightKind =
  | 'growth_change'
  | 'frequency_change'
  | 'format_shift'
  | 'engagement_change'
  | 'top_post'
  | 'bio_change'
  | 'website_change'
  | 'frequency_vs_own'
  | 'engagement_vs_own';

export type Insight = {
  id: string;
  kind: InsightKind;
  profileId: string | null;
  text: string;
  evidence: { label: string; value: string }[];
  href: string;
  linkLabel: string;
  external: boolean;
  dataSource: DataSource;
  /** Size of the change, used only to order statements. */
  magnitude: number;
};

export type PeriodStats = {
  growth: Growth;
  frequency: Frequency;
  engagement: Engagement;
  /** Posts published in the period (format mix). */
  published: PostRecord[];
  /** Posts measured at the fixed age during the period (engagement, top posts). */
  measured: PostRecord[];
};

export type ProfileInsightInput = {
  profile: ProfileRecord;
  current: PeriodStats;
  previous: PeriodStats;
  snapshots: ProfileSnapshotRecord[];
};

export type InsightThresholds = {
  minPosts: number;
  /** Follower growth rate difference, in rate units (0.005 = 0.5 percentage points). */
  growthRateDelta: number;
  frequencyRelative: number;
  frequencyAbsolute: number;
  formatShareDelta: number;
  engagementRelative: number;
};

export const DEFAULT_THRESHOLDS: InsightThresholds = {
  minPosts: MIN_POSTS_FOR_COMPARISON,
  growthRateDelta: 0.005,
  frequencyRelative: 0.25,
  frequencyAbsolute: 0.5,
  formatShareDelta: 0.2,
  engagementRelative: 0.2,
};

const ORDER: InsightKind[] = [
  'top_post',
  'engagement_vs_own',
  'frequency_vs_own',
  'growth_change',
  'engagement_change',
  'frequency_change',
  'format_shift',
  'bio_change',
  'website_change',
];

export function generateInsights(input: {
  orgSlug: string;
  /** The data source every value was filtered to (see comparisonSource). */
  source: DataSource;
  periods: { current: Period; previous: Period };
  profiles: readonly ProfileInsightInput[];
  thresholds?: Partial<InsightThresholds>;
  limit?: number;
}): Insight[] {
  const t = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  const link = (profile: ProfileRecord) => `/${input.orgSlug}/accounts/${profile.id}`;
  // Two profiles with the same name (one brand on several platforms) are told apart.
  const names = distinctNames(input.profiles.map((row) => row.profile));
  const profiles = input.profiles.map((row) => ({
    ...row,
    profile: { ...row.profile, name: names.get(row.profile.id) ?? row.profile.name },
  }));
  const insights: Insight[] = [];
  const { current, previous } = input.periods;

  for (const row of profiles) {
    const { profile } = row;
    const base = {
      profileId: profile.id,
      href: link(profile),
      linkLabel: `See ${profile.name}`,
      external: false,
    };

    // 1. Observed follower growth, this period vs the previous one.
    const g1 = row.current.growth;
    const g0 = row.previous.growth;
    if (
      g1.status === 'ok' &&
      g0.status === 'ok' &&
      g1.rate !== null &&
      g0.rate !== null &&
      g1.dataSource === g0.dataSource &&
      Math.abs(g1.rate - g0.rate) >= t.growthRateDelta
    ) {
      const reels = row.current.published.filter((p) => p.mediaFormat === 'short_video').length;
      const sameWindow =
        row.current.frequency.status === 'ok' && !row.current.frequency.clipped
          ? ` In the same period it published ${plural(row.current.frequency.posts, 'post')}${
              reels ? `, ${plural(reels, 'Reel')} among them` : ''
            }.`
          : '';
      insights.push({
        ...base,
        id: `growth_change:${profile.id}`,
        kind: 'growth_change',
        text: `${profile.name} ${growthPhrase(g1.rate)} between ${formatDay(g1.first.at)} and ${formatDay(g1.last.at)}, compared with ${signedOrNone(g0.rate)} between ${formatDay(g0.first.at)} and ${formatDay(g0.last.at)}.${sameWindow}`,
        evidence: [
          {
            label: 'This period',
            value: `${formatCount(g1.first.value)} → ${formatCount(g1.last.value)} (${formatSignedPercent(g1.rate)}, ${plural(g1.observations, 'observation')})`,
          },
          {
            label: 'Previous period',
            value: `${formatCount(g0.first.value)} → ${formatCount(g0.last.value)} (${formatSignedPercent(g0.rate)}, ${plural(g0.observations, 'observation')})`,
          },
        ],
        dataSource: g1.dataSource,
        magnitude: Math.abs(g1.rate - g0.rate),
      });
    }

    // 2. Posting frequency, this period vs the previous one (complete history only).
    const f1 = row.current.frequency;
    const f0 = row.previous.frequency;
    if (
      f1.status === 'ok' &&
      f0.status === 'ok' &&
      !f1.clipped &&
      !f0.clipped &&
      f1.posts + f0.posts >= t.minPosts
    ) {
      const delta = f1.postsPerWeek - f0.postsPerWeek;
      const rel = relativeChange(f0.postsPerWeek, f1.postsPerWeek);
      if (
        Math.abs(delta) >= t.frequencyAbsolute &&
        (rel === null || Math.abs(rel) >= t.frequencyRelative)
      ) {
        insights.push({
          ...base,
          id: `frequency_change:${profile.id}`,
          kind: 'frequency_change',
          text: `${profile.name} published ${plural(f1.posts, 'post')} in this period (${formatDecimal(f1.postsPerWeek)} a week), ${delta > 0 ? 'more' : 'fewer'} than the ${formatCount(f0.posts)} (${formatDecimal(f0.postsPerWeek)} a week) in the previous period.`,
          evidence: [
            {
              label: 'This period',
              value: `${plural(f1.posts, 'post')}, ${formatPeriod(current)}`,
            },
            {
              label: 'Previous period',
              value: `${plural(f0.posts, 'post')}, ${formatPeriod(previous)}`,
            },
          ],
          dataSource: profileSource(row, input.source),
          magnitude: Math.abs(rel ?? delta),
        });
      }
    }

    // 3. Format mix shift (at least `minPosts` posts on each side).
    if (
      row.current.published.length >= t.minPosts &&
      row.previous.published.length >= t.minPosts &&
      f1.status === 'ok' &&
      f0.status === 'ok'
    ) {
      const m1 = formatMix(row.current.published);
      const m0 = formatMix(row.previous.published);
      let best: {
        format: PostRecord['mediaFormat'];
        s1: number;
        s0: number;
        n1: number;
        n0: number;
      } | null = null;
      for (const format of new Set([...m1.formats, ...m0.formats].map((f) => f.format))) {
        const a = m1.formats.find((f) => f.format === format);
        const b = m0.formats.find((f) => f.format === format);
        const s1 = a?.share ?? 0;
        const s0 = b?.share ?? 0;
        if (Math.abs(s1 - s0) < t.formatShareDelta) continue;
        const size = Math.abs(s1 - s0);
        const bestSize = best ? Math.abs(best.s1 - best.s0) : -1;
        // On a tie, prefer the format that grew.
        if (size > bestSize || (size === bestSize && s1 > s0)) {
          best = { format, s1, s0, n1: a?.posts ?? 0, n0: b?.posts ?? 0 };
        }
      }
      if (best) {
        insights.push({
          ...base,
          id: `format_shift:${profile.id}`,
          kind: 'format_shift',
          text: `${MEDIA_FORMAT_LABELS[best.format]} posts made up ${formatShare(best.s1)} of ${profile.name}’s posts in this period (${best.n1} of ${m1.total}), compared with ${formatShare(best.s0)} (${best.n0} of ${m0.total}) in the previous period.`,
          evidence: [
            { label: 'This period', value: mixSummary(m1) },
            { label: 'Previous period', value: mixSummary(m0) },
          ],
          dataSource: profileSource(row, input.source),
          magnitude: Math.abs(best.s1 - best.s0),
        });
      }
    }

    // 4. Median public engagement at 7 days (at least `minPosts` posts on each side).
    const e1 = row.current.engagement;
    const e0 = row.previous.engagement;
    if (
      e1.status === 'ok' &&
      e0.status === 'ok' &&
      e1.dataSource === e0.dataSource &&
      e1.posts >= t.minPosts &&
      e0.posts >= t.minPosts
    ) {
      const rel = relativeChange(e0.median, e1.median);
      if (rel !== null && Math.abs(rel) >= t.engagementRelative) {
        insights.push({
          ...base,
          id: `engagement_change:${profile.id}`,
          kind: 'engagement_change',
          text: `${profile.name}’s median public engagement per post at 7 days was ${formatCount(e1.median)} likes and comments in this period (${plural(e1.posts, 'post')}), ${rel > 0 ? 'up' : 'down'} from ${formatCount(e0.median)} in the previous period (${plural(e0.posts, 'post')}).`,
          evidence: [
            { label: 'This period', value: engagementSummary(e1) },
            { label: 'Previous period', value: engagementSummary(e0) },
          ],
          dataSource: e1.dataSource,
          magnitude: Math.abs(rel),
        });
      }
    }

    // 5. Bio and website changes, from profile snapshots (written only when something changed).
    const snaps = [...row.snapshots].sort(
      (a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt),
    );
    for (let i = 1; i < snaps.length; i++) {
      const before = snaps[i - 1]!;
      const after = snaps[i]!;
      if (!inPeriod(after.observedAt, current) || before.dataSource !== after.dataSource) continue;
      if ((before.biography ?? '') !== (after.biography ?? '')) {
        insights.push({
          ...base,
          id: `bio_change:${profile.id}:${after.observedAt}`,
          kind: 'bio_change',
          text: `${profile.name} changed its bio; Scopie first saw the new text on ${formatDay(after.observedAt)}.`,
          evidence: [
            { label: 'Before', value: clip(before.biography) },
            { label: 'After', value: clip(after.biography) },
          ],
          dataSource: after.dataSource,
          magnitude: 0,
        });
      }
      if ((before.website ?? '') !== (after.website ?? '')) {
        insights.push({
          ...base,
          id: `website_change:${profile.id}:${after.observedAt}`,
          kind: 'website_change',
          text: `${profile.name} changed the website link on its profile; Scopie first saw it on ${formatDay(after.observedAt)}.`,
          evidence: [
            { label: 'Before', value: before.website || '(none)' },
            { label: 'After', value: after.website || '(none)' },
          ],
          dataSource: after.dataSource,
          magnitude: 0,
        });
      }
    }
  }

  insights.push(...topPostInsight(profiles, t.minPosts, link));
  insights.push(...versusOwn(profiles, t, link, input.source));

  const sorted = insights.sort(
    (a, b) =>
      ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) ||
      b.magnitude - a.magnitude ||
      a.id.localeCompare(b.id),
  );
  // Keep the list varied: at most two statements of a kind first, then the rest in order.
  const limit = input.limit ?? 8;
  const perKind = new Map<InsightKind, number>();
  const first: Insight[] = [];
  const rest: Insight[] = [];
  for (const insight of sorted) {
    const count = perKind.get(insight.kind) ?? 0;
    perKind.set(insight.kind, count + 1);
    (count < 2 ? first : rest).push(insight);
  }
  const chosen = new Set([...first, ...rest].slice(0, limit));
  return sorted.filter((insight) => chosen.has(insight));
}

/** The highest public engagement at 7 days among all posts measured in this period. */
function topPostInsight(
  profiles: readonly ProfileInsightInput[],
  minPosts: number,
  link: (profile: ProfileRecord) => string,
): Insight[] {
  const byId = new Map(profiles.map((row) => [row.profile.id, row.profile]));
  const now = profiles.flatMap((row) => row.current.measured);
  const before = profiles.flatMap((row) => row.previous.measured);
  const ranked = topPosts(now, now.length);
  if (ranked.length < minPosts) return [];
  const top = ranked[0]!;
  const previousTop = topPosts(before, 1)[0];
  if (
    previousTop &&
    (previousTop.dataSource !== top.dataSource || previousTop.engagement >= top.engagement)
  ) {
    return [];
  }
  const profile = byId.get(top.post.accountId);
  if (!profile) return [];
  const evidence = [
    { label: 'Likes', value: formatCount(top.likes) },
    { label: 'Comments', value: formatCount(top.comments) },
    { label: 'Posts compared', value: plural(ranked.length, 'post') },
  ];
  if (previousTop) {
    evidence.push({
      label: 'Highest in the previous period',
      value: `${formatCount(previousTop.engagement)} likes and comments`,
    });
  }
  return [
    {
      id: `top_post:${top.post.id}`,
      kind: 'top_post',
      profileId: profile.id,
      text: `${withArticle(MEDIA_FORMAT_LABELS[top.post.mediaFormat].toLowerCase())} post by ${profile.name} from ${formatDay(top.post.publishedAt)} had the highest public engagement at 7 days of the ${plural(ranked.length, 'post')} measured in this period: ${formatCount(top.engagement)} likes and comments${previousTop ? `, more than any post in the previous period (highest ${formatCount(previousTop.engagement)})` : ''}.`,
      evidence,
      href: top.post.permalink ?? link(profile),
      linkLabel: top.post.permalink ? 'Open the post' : `See ${profile.name}`,
      external: Boolean(top.post.permalink),
      dataSource: top.dataSource,
      magnitude: top.engagement,
    },
  ];
}

/** Each competitor against the median of your own profiles on the same platform. */
function versusOwn(
  profiles: readonly ProfileInsightInput[],
  t: InsightThresholds,
  link: (profile: ProfileRecord) => string,
  source: DataSource,
): Insight[] {
  const out: Insight[] = [];
  const own = profiles.filter((row) => row.profile.businessRole === 'owned');
  for (const row of profiles) {
    if (row.profile.businessRole !== 'competitor') continue;
    const platform = row.profile.platformKey;
    const ownSame = own.filter((o) => o.profile.platformKey === platform);
    if (!ownSame.length) continue;
    const base = {
      profileId: row.profile.id,
      href: link(row.profile),
      linkLabel: `See ${row.profile.name}`,
      external: false,
    };

    // Posting frequency vs the median of own profiles with a complete, unclipped history.
    const f = row.current.frequency;
    const ownFreq = ownSame
      .map((o) => o.current.frequency)
      .filter((x): x is Extract<Frequency, { status: 'ok' }> => x.status === 'ok' && !x.clipped);
    const ownMedian = median(ownFreq.map((x) => x.postsPerWeek));
    if (
      f.status === 'ok' &&
      !f.clipped &&
      ownMedian !== null &&
      f.posts + ownFreq.reduce((s, x) => s + x.posts, 0) >= t.minPosts
    ) {
      const rel = relativeChange(ownMedian, f.postsPerWeek);
      const delta = f.postsPerWeek - ownMedian;
      if (
        Math.abs(delta) >= t.frequencyAbsolute &&
        (rel === null || Math.abs(rel) >= t.frequencyRelative)
      ) {
        const amount =
          rel === null
            ? ''
            : `${formatShare(Math.abs(rel))} ${rel > 0 ? 'more' : 'fewer'} posts per week than`;
        out.push({
          ...base,
          id: `frequency_vs_own:${row.profile.id}`,
          kind: 'frequency_vs_own',
          text:
            rel === null
              ? `${row.profile.name} published ${formatDecimal(f.postsPerWeek)} posts a week in this period; your own ${platformName(platform)} profiles published none.`
              : `${row.profile.name} published ${amount} the median of your own ${platformName(platform)} profiles in this period (${formatDecimal(f.postsPerWeek)} vs ${formatDecimal(ownMedian)}).`,
          evidence: [
            {
              label: row.profile.name,
              value: `${plural(f.posts, 'post')} in ${formatDecimal(f.weeks)} weeks`,
            },
            { label: 'Own profiles counted', value: String(ownFreq.length) },
          ],
          dataSource: profileSource(row, source),
          magnitude: Math.abs(rel ?? delta),
        });
      }
    }

    // Median public engagement vs all posts of own profiles on the platform, pooled.
    const e = row.current.engagement;
    const pooled = ownSame.flatMap((o) => o.current.measured);
    if (e.status === 'ok' && e.posts >= t.minPosts && pooled.length) {
      const ownEngagement = topPosts(pooled, pooled.length).filter(
        (p) => p.dataSource === e.dataSource,
      );
      const ownMed = median(ownEngagement.map((p) => p.engagement));
      if (ownMed !== null && ownEngagement.length >= t.minPosts) {
        const rel = relativeChange(ownMed, e.median);
        if (rel !== null && Math.abs(rel) >= t.engagementRelative) {
          out.push({
            ...base,
            id: `engagement_vs_own:${row.profile.id}`,
            kind: 'engagement_vs_own',
            text: `${row.profile.name}’s median public engagement per post at 7 days was ${rel > 0 ? 'higher' : 'lower'} than your own ${platformName(platform)} profiles’ in this period (${formatCount(e.median)} vs ${formatCount(ownMed)}; ${formatCount(e.posts)} and ${plural(ownEngagement.length, 'post')}).`,
            evidence: [
              { label: row.profile.name, value: engagementSummary(e) },
              {
                label: 'Own profiles',
                value: `median ${formatCount(ownMed)}, ${plural(ownEngagement.length, 'post')}`,
              },
            ],
            dataSource: e.dataSource,
            magnitude: Math.abs(rel),
          });
        }
      }
    }
  }
  return out;
}

function withArticle(word: string): string {
  return `${/^[aeiou]/i.test(word) ? 'An' : 'A'} ${word}`;
}

function growthPhrase(rate: number): string {
  if (rate > 0) return `gained ${formatSignedPercent(rate).slice(1)} followers`;
  if (rate < 0) return `lost ${formatSignedPercent(rate).slice(1)} of its followers`;
  return 'kept the same number of followers';
}

function signedOrNone(rate: number): string {
  return rate === 0 ? 'no change' : formatSignedPercent(rate);
}

function plural(count: number, noun: string): string {
  return `${formatCount(count)} ${noun}${count === 1 ? '' : 's'}`;
}

function clip(text: string | null, max = 160): string {
  if (!text) return '(empty)';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function mixSummary(mix: ReturnType<typeof formatMix>): string {
  return mix.formats.map((f) => `${MEDIA_FORMAT_LABELS[f.format]} ${f.posts}`).join(', ');
}

function engagementSummary(e: Extract<Engagement, { status: 'ok' }>): string {
  const excluded = e.excludedHidden
    ? `; ${plural(e.excludedHidden, 'post')} with hidden likes left out`
    : '';
  return `median ${formatCount(e.median)}, mean ${formatCount(e.mean)}, ${plural(e.posts, 'post')}${excluded}`;
}

/** Source of the posts counted for a profile; falls back to the comparison source. */
function profileSource(row: ProfileInsightInput, fallback: DataSource): DataSource {
  return row.current.published[0]?.dataSource ?? row.previous.published[0]?.dataSource ?? fallback;
}
