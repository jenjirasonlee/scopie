import { MEDIA_FORMAT_LABELS } from '@/lib/analytics/content';
import { ENGAGEMENT_AGE_DAYS, postEngagement } from '@/lib/analytics/engagement';
import { formatCount, formatSignedCount } from '@/lib/analytics/format';
import { postingFrequency } from '@/lib/analytics/frequency';
import { observedGrowth } from '@/lib/analytics/growth';
import { platformName } from '@/lib/analytics/names';
import { DAY_MS, inPeriod } from '@/lib/analytics/range';
import { median } from '@/lib/analytics/stats';
import type {
  FollowerObservation,
  MediaFormat,
  Period,
  PostRecord,
  ProfileRecord,
} from '@/lib/analytics/types';
import type { Coverage } from '@/lib/strategy/coverage';
import type { Evidence, InsightSeverity, Signal, SignalStats } from './types';

// Deterministic signal detection (AI_ARCHITECTURE.md §3). Everything here is arithmetic on
// stored values; nothing is estimated. Each signal carries the evidence it rests on and the
// numbers its confidence is computed from. Wording happens later, in rules.ts or a model.

export const SIGNAL_RULES = {
  /** Posts a profile needs before its own usual engagement is known. */
  minProfilePosts: 5,
  /** Posts a format needs before it is compared with the rest. */
  minSegmentPosts: 8,
  winnerRatio: 1.25,
  loserRatio: 0.8,
  /** Competitors' share of a format must beat the organization's by this much. */
  formatShareGap: 0.15,
  minTopicPosts: 3,
  topicRatio: 1.3,
  maxTopics: 3,
  standoutRatio: 3,
  maxStandouts: 2,
  /** Follower growth rate difference, in rate units (0.005 = 0.5 percentage points). */
  growthRateDelta: 0.005,
  frequencyRelative: 0.25,
  frequencyAbsolute: 0.5,
} as const;

export type SignalInput = {
  profiles: readonly ProfileRecord[];
  followers: ReadonlyMap<string, readonly FollowerObservation[]>;
  posts: ReadonlyMap<string, readonly PostRecord[]>;
  periods: { current: Period; previous: Period };
  /** Display names that tell profiles apart (distinctNames). */
  names: ReadonlyMap<string, string>;
  /** Active strategies running now, with their coverage. */
  strategies: readonly { id: string; name: string; coverage: Coverage }[];
};

type Draft = Omit<Signal, 'id' | 'evidence'> & { evidence: Omit<Evidence, 'id'>[] };

const iso = (date: Date) => date.toISOString();
const ratioText = (ratio: number) => `${ratio.toFixed(1)}×`;
const percent = (share: number) => `${Math.round(share * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One post measured at the fixed age, relative to its own profile's usual engagement. */
export type RelativePost = {
  postId: string;
  accountId: string;
  platformKey: string;
  format: MediaFormat;
  hashtags: string[];
  publishedAt: string;
  permalink: string | null;
  engagement: number;
  /** Engagement divided by the profile's median engagement in the same window. */
  ratio: number;
};

/**
 * Posts published in the window with likes + comments at 7 days old, each divided by its
 * profile's median. Comparing each post with its own profile's usual keeps big and small
 * profiles comparable. Profiles with fewer than five measured posts, or a median of 0, are
 * left out: their usual isn't known.
 */
export function relativePosts(
  profiles: readonly ProfileRecord[],
  posts: ReadonlyMap<string, readonly PostRecord[]>,
  window: Period,
): RelativePost[] {
  const out: RelativePost[] = [];
  for (const profile of profiles) {
    const measured = (posts.get(profile.id) ?? []).flatMap((post) => {
      if (!inPeriod(post.publishedAt, window)) return [];
      const engagement = postEngagement(post);
      return engagement.status === 'ok' ? [{ post, value: engagement.value }] : [];
    });
    if (measured.length < SIGNAL_RULES.minProfilePosts) continue;
    const usual = median(measured.map((m) => m.value))!;
    if (usual <= 0) continue;
    for (const { post, value } of measured) {
      out.push({
        postId: post.id,
        accountId: profile.id,
        platformKey: profile.platformKey,
        format: post.mediaFormat,
        hashtags: post.hashtags.map((tag) => tag.toLowerCase().replace(/^#/, '')),
        publishedAt: post.publishedAt,
        permalink: post.permalink,
        engagement: value,
        ratio: value / usual,
      });
    }
  }
  return out;
}

export type FormatSegment = {
  platformKey: string;
  format: MediaFormat;
  /** Median of the posts' ratios. */
  ratio: number;
  posts: number;
  /** Share of all posts on the platform in the window. */
  share: number;
  stats: SignalStats;
  accountIds: string[];
};

/** Per platform and format: how posts of that format do against their profiles' usual. */
export function formatSegments(posts: readonly RelativePost[]): FormatSegment[] {
  const byPlatform = new Map<string, RelativePost[]>();
  for (const post of posts) {
    byPlatform.set(post.platformKey, [...(byPlatform.get(post.platformKey) ?? []), post]);
  }
  const segments: FormatSegment[] = [];
  for (const [platformKey, list] of byPlatform) {
    const formats = new Map<MediaFormat, RelativePost[]>();
    for (const post of list) formats.set(post.format, [...(formats.get(post.format) ?? []), post]);
    for (const [format, inFormat] of formats) {
      const others = list.length - inFormat.length;
      if (inFormat.length < SIGNAL_RULES.minSegmentPosts || others < SIGNAL_RULES.minSegmentPosts) {
        continue;
      }
      const ratio = median(inFormat.map((p) => p.ratio))!;
      const accounts = new Map<string, number[]>();
      for (const post of inFormat) {
        accounts.set(post.accountId, [...(accounts.get(post.accountId) ?? []), post.ratio]);
      }
      // A profile agrees when its own posts of this format sit on the same side of its usual.
      const judged = [...accounts.values()].filter((ratios) => ratios.length >= 2);
      const agreeing = judged.filter((ratios) => median(ratios)! >= 1 === ratio >= 1).length;
      segments.push({
        platformKey,
        format,
        ratio,
        posts: inFormat.length,
        share: inFormat.length / list.length,
        stats: {
          n: inFormat.length,
          accounts: judged.length,
          consistentAccounts: agreeing,
          effect: ratio >= 1 ? ratio : ratio > 0 ? 1 / ratio : 1,
        },
        accountIds: [...accounts.keys()],
      });
    }
  }
  return segments;
}

function severityFor(stats: SignalStats): InsightSeverity {
  if (stats.effect >= 1.5 && stats.n >= 20) return 'important';
  if (stats.effect >= 1.25) return 'notable';
  return 'info';
}

/** Finds every signal in the data, strongest first, with ids "s1", "s2", … */
export function detectSignals(input: SignalInput): Signal[] {
  const { current, previous } = input.periods;
  const name = (id: string) => input.names.get(id) ?? 'A profile';
  const active = input.profiles.filter((p) => p.isActive);
  const own = active.filter((p) => p.businessRole === 'owned');
  const competitors = active.filter((p) => p.businessRole === 'competitor');
  // Posts need 7 days before their engagement is measured, so the window ends a week ago.
  const window: Period = {
    start: previous.start,
    end: new Date(current.end.getTime() - ENGAGEMENT_AGE_DAYS * DAY_MS),
  };
  const windowText = { periodStart: iso(window.start), periodEnd: iso(window.end) };
  const engagementMethod = `Likes + comments at ${ENGAGEMENT_AGE_DAYS} days old, divided by the profile's median for posts in the same window; the median of those ratios.`;
  const drafts: Draft[] = [];

  // 1. Follower growth and posting frequency, this period against the previous one.
  for (const profile of [...own, ...competitors]) {
    const observations = input.followers.get(profile.id) ?? [];
    const now = observedGrowth(observations, current);
    const before = observedGrowth(observations, previous);
    if (
      now.status === 'ok' &&
      before.status === 'ok' &&
      now.rate !== null &&
      before.rate !== null
    ) {
      const delta = now.rate - before.rate;
      if (Math.abs(delta) >= SIGNAL_RULES.growthRateDelta) {
        drafts.push({
          kind: 'growth_change',
          severity: Math.abs(delta) >= 0.01 ? 'notable' : 'info',
          strength: Math.abs(delta) * 100,
          accountIds: [profile.id],
          stats: { n: now.observations, accounts: 1, consistentAccounts: 1, effect: 1 },
          facts: {
            profile: name(profile.id),
            role: profile.businessRole === 'owned' ? 'own' : 'competitor',
            direction: delta > 0 ? 'faster' : 'slower',
          },
          path: `/accounts/${profile.id}`,
          evidence: [
            {
              label: `Followers gained by ${name(profile.id)}, this period`,
              value: now.change,
              display: formatSignedCount(now.change),
              periodStart: iso(current.start),
              periodEnd: iso(current.end),
              method: 'Last follower observation in the period minus the first.',
              accountIds: [profile.id],
            },
            {
              label: 'Growth rate, this period',
              value: now.rate,
              display: `${(now.rate * 100).toFixed(1)}%`,
              periodStart: iso(current.start),
              periodEnd: iso(current.end),
              method: 'Followers gained divided by followers at the first observation.',
              accountIds: [profile.id],
            },
            {
              label: 'Growth rate, previous period',
              value: before.rate,
              display: `${(before.rate * 100).toFixed(1)}%`,
              periodStart: iso(previous.start),
              periodEnd: iso(previous.end),
              method: 'Followers gained divided by followers at the first observation.',
              accountIds: [profile.id],
            },
          ],
        });
      }
    }

    const posts = (input.posts.get(profile.id) ?? []).map((post) => post.publishedAt);
    const frequency = (period: Period) =>
      postingFrequency({
        publishedAt: posts,
        earliestPostAt: profile.earliestPostAt,
        period,
        observedUntil: profile.lastObservedAt,
      });
    const f1 = frequency(current);
    const f0 = frequency(previous);
    if (f1.status === 'ok' && f0.status === 'ok' && f0.postsPerWeek > 0) {
      const difference = f1.postsPerWeek - f0.postsPerWeek;
      const relative = difference / f0.postsPerWeek;
      if (
        Math.abs(relative) >= SIGNAL_RULES.frequencyRelative &&
        Math.abs(difference) >= SIGNAL_RULES.frequencyAbsolute
      ) {
        drafts.push({
          kind: 'frequency_change',
          severity: Math.abs(relative) >= 0.5 ? 'notable' : 'info',
          strength: Math.abs(relative),
          accountIds: [profile.id],
          stats: { n: f1.posts + f0.posts, accounts: 1, consistentAccounts: 1, effect: 1 },
          facts: {
            profile: name(profile.id),
            role: profile.businessRole === 'owned' ? 'own' : 'competitor',
            direction: difference > 0 ? 'more' : 'less',
          },
          path: `/accounts/${profile.id}`,
          evidence: [
            {
              label: 'Posts per week, this period',
              value: f1.postsPerWeek,
              display: f1.postsPerWeek.toFixed(1),
              n: f1.posts,
              periodStart: f1.from,
              periodEnd: f1.to,
              method: 'Posts published in the period divided by its length in weeks.',
              accountIds: [profile.id],
            },
            {
              label: 'Posts per week, previous period',
              value: f0.postsPerWeek,
              display: f0.postsPerWeek.toFixed(1),
              n: f0.posts,
              periodStart: f0.from,
              periodEnd: f0.to,
              method: 'Posts published in the period divided by its length in weeks.',
              accountIds: [profile.id],
            },
          ],
        });
      }
    }
  }

  // 2. Formats that do better or worse than usual on the organization's own profiles.
  const ownPosts = relativePosts(own, input.posts, window);
  const ownSegments = formatSegments(ownPosts);
  for (const segment of ownSegments) {
    const winner = segment.ratio >= SIGNAL_RULES.winnerRatio;
    if (!winner && segment.ratio > SIGNAL_RULES.loserRatio) continue;
    const format = MEDIA_FORMAT_LABELS[segment.format];
    drafts.push({
      kind: winner ? 'format_winner' : 'format_loser',
      severity: severityFor(segment.stats),
      strength: segment.stats.effect * Math.log(segment.posts),
      accountIds: segment.accountIds,
      stats: segment.stats,
      facts: {
        format,
        formatKey: segment.format,
        platform: platformName(segment.platformKey),
        platformKey: segment.platformKey,
      },
      path: '/analytics',
      evidence: [
        {
          label: `${format} on ${platformName(segment.platformKey)}: engagement against each profile's usual`,
          value: segment.ratio,
          display: ratioText(segment.ratio),
          n: segment.posts,
          ...windowText,
          method: engagementMethod,
          accountIds: segment.accountIds,
        },
        {
          label: `Share of your ${platformName(segment.platformKey)} posts that were ${format}`,
          value: segment.share,
          display: percent(segment.share),
          n: segment.posts,
          ...windowText,
          method: 'Posts of this format divided by all measured posts on the platform.',
          accountIds: segment.accountIds,
        },
      ],
    });
  }

  // 3. Formats that do well for competitors and that the organization uses less.
  const competitorPosts = relativePosts(competitors, input.posts, window);
  for (const segment of formatSegments(competitorPosts)) {
    if (segment.ratio < SIGNAL_RULES.winnerRatio) continue;
    const ownOnPlatform = ownPosts.filter((p) => p.platformKey === segment.platformKey);
    const ownShare = ownOnPlatform.length
      ? ownOnPlatform.filter((p) => p.format === segment.format).length / ownOnPlatform.length
      : null;
    if (ownShare !== null && ownShare > segment.share - SIGNAL_RULES.formatShareGap) continue;
    const format = MEDIA_FORMAT_LABELS[segment.format];
    const ownAccounts = own.filter((p) => p.platformKey === segment.platformKey).map((p) => p.id);
    drafts.push({
      kind: 'competitor_format',
      severity: severityFor(segment.stats),
      strength: segment.stats.effect * Math.log(segment.posts),
      accountIds: [...segment.accountIds, ...ownAccounts],
      stats: segment.stats,
      facts: {
        format,
        formatKey: segment.format,
        platform: platformName(segment.platformKey),
        platformKey: segment.platformKey,
        ownAccountIds: ownAccounts.join(','),
      },
      path: '/benchmarks',
      evidence: [
        {
          label: `Competitors' ${format} on ${platformName(segment.platformKey)}: engagement against each profile's usual`,
          value: segment.ratio,
          display: ratioText(segment.ratio),
          n: segment.posts,
          ...windowText,
          method: engagementMethod,
          accountIds: segment.accountIds,
        },
        {
          label: `Share of competitors' ${platformName(segment.platformKey)} posts that were ${format}`,
          value: segment.share,
          display: percent(segment.share),
          n: segment.posts,
          ...windowText,
          method: 'Posts of this format divided by all their measured posts on the platform.',
          accountIds: segment.accountIds,
        },
        ...(ownShare === null
          ? []
          : [
              {
                label: `Share of your ${platformName(segment.platformKey)} posts that were ${format}`,
                value: ownShare,
                display: percent(ownShare),
                n: ownOnPlatform.length,
                ...windowText,
                method: 'Posts of this format divided by all your measured posts on the platform.',
                accountIds: ownAccounts,
              },
            ]),
      ],
    });
  }

  // 4. Topics (hashtags) that do well for competitors and that the organization hasn't used.
  const ownTags = new Set(
    own.flatMap((profile) =>
      (input.posts.get(profile.id) ?? [])
        .filter((post) => inPeriod(post.publishedAt, { start: previous.start, end: current.end }))
        .flatMap((post) => post.hashtags.map((tag) => tag.toLowerCase().replace(/^#/, ''))),
    ),
  );
  const topics = new Map<string, RelativePost[]>();
  for (const post of competitorPosts) {
    for (const tag of new Set(post.hashtags)) {
      if (tag && !ownTags.has(tag)) topics.set(tag, [...(topics.get(tag) ?? []), post]);
    }
  }
  [...topics.entries()]
    .map(([tag, posts]) => ({ tag, posts, ratio: median(posts.map((p) => p.ratio))! }))
    .filter(
      (t) => t.posts.length >= SIGNAL_RULES.minTopicPosts && t.ratio >= SIGNAL_RULES.topicRatio,
    )
    .sort((a, b) => b.ratio * Math.sqrt(b.posts.length) - a.ratio * Math.sqrt(a.posts.length))
    .slice(0, SIGNAL_RULES.maxTopics)
    .forEach(({ tag, posts, ratio }) => {
      const accounts = [...new Set(posts.map((p) => p.accountId))];
      const agreeing = accounts.filter(
        (id) => median(posts.filter((p) => p.accountId === id).map((p) => p.ratio))! >= 1,
      ).length;
      const stats = {
        n: posts.length,
        accounts: accounts.length,
        consistentAccounts: agreeing,
        effect: ratio,
      };
      drafts.push({
        kind: 'topic_gap',
        severity: severityFor(stats),
        strength: ratio * Math.log(posts.length + 1),
        accountIds: accounts,
        stats,
        facts: { tag: `#${tag}`, competitors: accounts.map(name).join(', ') },
        path: '/benchmarks',
        evidence: [
          {
            label: `Competitor posts with #${tag}: engagement against each profile's usual`,
            value: ratio,
            display: ratioText(ratio),
            n: posts.length,
            ...windowText,
            method: engagementMethod,
            accountIds: accounts,
          },
          {
            label: `Your posts with #${tag}`,
            value: 0,
            display: '0 posts',
            periodStart: iso(previous.start),
            periodEnd: iso(current.end),
            method: 'Posts on your own profiles that Scopie stored for this period, counted.',
            accountIds: own.map((p) => p.id),
          },
        ],
      });
    });

  // 5. Single posts far above their profile's usual, published this period.
  const measuredNow: Period = {
    start: new Date(current.start.getTime() - ENGAGEMENT_AGE_DAYS * DAY_MS),
    end: window.end,
  };
  ownPosts
    .filter((p) => p.ratio >= SIGNAL_RULES.standoutRatio && inPeriod(p.publishedAt, measuredNow))
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, SIGNAL_RULES.maxStandouts)
    .forEach((post) => {
      const profile = own.find((p) => p.id === post.accountId)!;
      const others = own
        .filter((p) => p.id !== profile.id && p.platformKey === profile.platformKey)
        .map((p) => p.id);
      drafts.push({
        kind: 'standout_post',
        severity: 'notable',
        strength: post.ratio,
        accountIds: [profile.id, ...others],
        stats: { n: 1, accounts: 1, consistentAccounts: 1, effect: post.ratio },
        facts: {
          profile: name(profile.id),
          format: MEDIA_FORMAT_LABELS[post.format],
          platform: platformName(profile.platformKey),
          permalink: post.permalink ?? '',
          otherAccountIds: others.join(','),
        },
        path: `/accounts/${profile.id}`,
        evidence: [
          {
            label: `Likes + comments at ${ENGAGEMENT_AGE_DAYS} days on one ${MEDIA_FORMAT_LABELS[post.format]} by ${name(profile.id)}`,
            value: post.engagement,
            display: formatCount(post.engagement),
            periodStart: post.publishedAt,
            periodEnd: post.publishedAt,
            method: `Stored likes + comments when the post was ${ENGAGEMENT_AGE_DAYS} days old.`,
            accountIds: [profile.id],
          },
          {
            label: "Against the profile's usual",
            value: post.ratio,
            display: ratioText(post.ratio),
            ...windowText,
            method: engagementMethod,
            accountIds: [profile.id],
          },
        ],
      });
    });

  // 6. Pillars under their target share in a running strategy.
  for (const strategy of input.strategies) {
    if (!strategy.coverage.comparable) continue;
    for (const row of strategy.coverage.rows) {
      if (row.verdict !== 'under' || row.targetShare === null || row.share === null) continue;
      const gap = row.targetShare - row.share;
      // Items to add on this pillar, other things equal, to reach the target share.
      const target = row.targetShare / 100;
      const missing =
        target < 1
          ? Math.max(1, Math.ceil((target * strategy.coverage.total - row.total) / (1 - target)))
          : strategy.coverage.total - row.total;
      drafts.push({
        kind: 'pillar_gap',
        severity: gap >= 15 ? 'important' : 'notable',
        strength: gap / 5,
        accountIds: [],
        stats: {
          n: strategy.coverage.total,
          accounts: 0,
          consistentAccounts: 0,
          effect: row.targetShare / Math.max(row.share, 1),
        },
        facts: {
          pillar: row.name,
          strategy: strategy.name,
          missing,
        },
        path: `/strategy/${strategy.id}`,
        evidence: [
          {
            label: `Share of ${strategy.name} content on ${row.name}`,
            value: row.share,
            display: `${Math.round(row.share)}%`,
            n: strategy.coverage.total,
            periodStart: iso(current.start),
            periodEnd: iso(current.end),
            method:
              "Content planned or published in the strategy's period, markets and platforms on this pillar, divided by all of it.",
            accountIds: [],
          },
          {
            label: `Target share for ${row.name}`,
            value: row.targetShare,
            display: `${Math.round(row.targetShare)}%`,
            periodStart: iso(current.start),
            periodEnd: iso(current.end),
            method: 'Set on the strategy.',
            accountIds: [],
          },
          {
            label: `${row.name} items planned or published`,
            value: row.total,
            display: plural(row.total, 'item'),
            periodStart: iso(current.start),
            periodEnd: iso(current.end),
            method: 'Content items counted.',
            accountIds: [],
          },
        ],
      });
    }
  }

  return drafts
    .sort((a, b) => b.strength - a.strength)
    .map((draft, index) => {
      const id = `s${index + 1}`;
      return {
        ...draft,
        id,
        evidence: draft.evidence.map((evidence, k) => ({ ...evidence, id: `${id}.e${k + 1}` })),
      };
    });
}
