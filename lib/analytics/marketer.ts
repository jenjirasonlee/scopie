import { MEDIA_FORMAT_LABELS } from './content';
import { postEngagement } from './engagement';
import { formatCompact, formatDecimal } from './format';
import { postingFrequency, type Frequency } from './frequency';
import { latestFollowers, observedGrowth, type Growth } from './growth';
import { inPeriod } from './range';
import { median } from './stats';
import type { FollowerObservation, MediaFormat, Period, PostRecord, ProfileRecord } from './types';

/**
 * The marketer's view on the dashboard: how our profiles compare with the ones we watch,
 * which of their posts did best, and which formats and days work. Built only from what
 * Scopie observed. Likes and comments are the latest values Scopie read for each post, shown
 * with the post's age; nothing is estimated and a missing value is never treated as zero.
 */

/** A post with its latest observed likes and comments (post_metrics_latest). */
export type ObservedPost = PostRecord & {
  /** Age of the post when the likes and comments were read. */
  ageHours: number | null;
};

/** Posts younger than this are still gathering likes, so they aren't compared yet. */
export const MIN_POST_AGE_HOURS = 48;
/** Fewer measured posts than this and a profile's typical post isn't reported. */
export const MIN_POSTS_FOR_TYPICAL = 3;
/** A format or weekday needs this many measured posts before it is compared. */
export const MIN_POSTS_PER_GROUP = 3;

export type ProfileSummary = {
  profile: ProfileRecord;
  own: boolean;
  followers: number | null;
  growth: Growth;
  frequency: Frequency;
  /** Median likes + comments per post (posts at least 2 days old), or null. */
  typicalEngagement: number | null;
  /** typicalEngagement as a share of followers, or null. */
  engagementRate: number | null;
  measuredPosts: number;
  hiddenLikes: number;
};

export type WinningPost = {
  post: ObservedPost;
  profile: ProfileRecord;
  likes: number;
  comments: number;
  engagement: number;
  /** engagement / followers, when followers are known. */
  rate: number | null;
  /** engagement / the profile's typical post, when it has enough measured posts. */
  timesTypical: number | null;
};

export type GroupResult<K extends string | number> = {
  key: K;
  label: string;
  posts: number;
  /** Median likes + comments as a share of followers. */
  medianRate: number;
};

export type MarketerView = {
  period: Period;
  /** Profiles are compared within one platform; numbers across platforms don't compare. */
  platformKey: string | null;
  platforms: { key: string; profiles: number }[];
  hasOwn: boolean;
  profiles: ProfileSummary[];
  headlines: string[];
  winningPosts: WinningPost[];
  formats: GroupResult<MediaFormat>[];
  weekdays: GroupResult<number>[];
  /** Watched posts in the period that are measured (at least 2 days old, likes visible). */
  measuredWatchedPosts: number;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function buildMarketerView(input: {
  period: Period;
  timeZone: string;
  profiles: readonly ProfileRecord[];
  followers: Map<string, FollowerObservation[]>;
  posts: readonly ObservedPost[];
  /** The platform asked for; the best-covered one when missing or unknown. */
  platformKey?: string | null;
}): MarketerView {
  const { period } = input;
  const allActive = input.profiles.filter((p) => p.isActive);
  const platforms = choosePlatforms(allActive);
  const platformKey =
    platforms.find((p) => p.key === input.platformKey)?.key ?? platforms[0]?.key ?? null;
  const active = allActive.filter((p) => p.platformKey === platformKey);
  const byId = new Map(active.map((p) => [p.id, p]));
  const postsByProfile = new Map<string, ObservedPost[]>();
  for (const post of input.posts) {
    if (!byId.has(post.accountId)) continue;
    const list = postsByProfile.get(post.accountId) ?? [];
    list.push(post);
    postsByProfile.set(post.accountId, list);
  }

  const measured = (post: ObservedPost) => {
    if (post.ageHours === null || post.ageHours < MIN_POST_AGE_HOURS) return null;
    if (!inPeriod(post.publishedAt, period)) return null;
    const engagement = postEngagement(post);
    return engagement.status === 'ok' ? engagement : null;
  };

  const profiles: ProfileSummary[] = active.map((profile) => {
    const posts = postsByProfile.get(profile.id) ?? [];
    const observations = input.followers.get(profile.id) ?? [];
    const followers = latestFollowers(observations)?.value ?? null;
    const values = posts.flatMap((post) => {
      const engagement = measured(post);
      return engagement ? [engagement.value] : [];
    });
    const typical = values.length >= MIN_POSTS_FOR_TYPICAL ? median(values) : null;
    return {
      profile,
      own: profile.businessRole === 'owned',
      followers,
      growth: observedGrowth(observations, period),
      frequency: postingFrequency({
        publishedAt: posts.map((p) => p.publishedAt),
        earliestPostAt: profile.earliestPostAt,
        observedUntil: profile.lastObservedAt,
        period,
        clip: true,
      }),
      typicalEngagement: typical,
      engagementRate: typical !== null && followers ? typical / followers : null,
      measuredPosts: values.length,
      hiddenLikes: posts.filter(
        (p) => inPeriod(p.publishedAt, period) && postEngagement(p).status === 'hidden_by_owner',
      ).length,
    };
  });
  profiles.sort(
    (a, b) =>
      Number(b.own) - Number(a.own) ||
      (b.followers ?? -1) - (a.followers ?? -1) ||
      a.profile.name.localeCompare(b.profile.name),
  );
  const summaryById = new Map(profiles.map((s) => [s.profile.id, s]));

  // Posts by the profiles we watch (everything that isn't ours), measured and in the period.
  const watched: WinningPost[] = [];
  for (const post of input.posts) {
    const summary = summaryById.get(post.accountId);
    if (!summary || summary.own) continue;
    const engagement = measured(post);
    if (!engagement) continue;
    watched.push({
      post,
      profile: summary.profile,
      likes: engagement.likes,
      comments: engagement.comments,
      engagement: engagement.value,
      rate: summary.followers ? engagement.value / summary.followers : null,
      timesTypical: summary.typicalEngagement ? engagement.value / summary.typicalEngagement : null,
    });
  }

  // Rank by share of followers, so a big account doesn't win just for being big.
  const winningPosts = watched
    .filter((w) => w.rate !== null)
    .sort((a, b) => b.rate! - a.rate! || b.engagement - a.engagement)
    .slice(0, 6);

  const rated = watched.filter((w) => w.rate !== null);
  const formats = groupBy(
    rated,
    (w) => w.post.mediaFormat,
    (format) => MEDIA_FORMAT_LABELS[format],
  );
  const weekdayOf = (at: string) =>
    WEEKDAYS.indexOf(
      new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: input.timeZone }).format(
        new Date(at),
      ),
    );
  const weekdays = groupBy(
    rated,
    (w) => weekdayOf(w.post.publishedAt),
    (day) => WEEKDAYS[day]!,
  );

  const view: MarketerView = {
    period,
    platformKey,
    platforms: platforms.map(({ key, profiles: count }) => ({ key, profiles: count })),
    hasOwn: profiles.some((p) => p.own),
    profiles,
    headlines: [],
    winningPosts,
    formats,
    weekdays,
    measuredWatchedPosts: watched.length,
  };
  view.headlines = headlines(view);
  return view;
}

/** Platforms with active profiles; ones where we can compare ourselves with others first. */
function choosePlatforms(active: readonly ProfileRecord[]) {
  const byKey = new Map<string, { key: string; profiles: number; own: number }>();
  for (const profile of active) {
    const entry = byKey.get(profile.platformKey) ?? {
      key: profile.platformKey,
      profiles: 0,
      own: 0,
    };
    entry.profiles++;
    if (profile.businessRole === 'owned') entry.own++;
    byKey.set(profile.platformKey, entry);
  }
  const comparable = (e: { profiles: number; own: number }) =>
    Number(e.own > 0 && e.profiles > e.own);
  return [...byKey.values()].sort(
    (a, b) =>
      comparable(b) - comparable(a) || b.profiles - a.profiles || a.key.localeCompare(b.key),
  );
}

function groupBy<K extends string | number>(
  posts: readonly WinningPost[],
  keyOf: (post: WinningPost) => K,
  labelOf: (key: K) => string,
): GroupResult<K>[] {
  const groups = new Map<K, number[]>();
  for (const post of posts) {
    const key = keyOf(post);
    groups.set(key, [...(groups.get(key) ?? []), post.rate!]);
  }
  return [...groups.entries()]
    .filter(([, rates]) => rates.length >= MIN_POSTS_PER_GROUP)
    .map(([key, rates]) => ({
      key,
      label: labelOf(key),
      posts: rates.length,
      medianRate: median(rates)!,
    }))
    .sort((a, b) => b.medianRate - a.medianRate);
}

const name = (summary: ProfileSummary) =>
  summary.profile.handle ? `@${summary.profile.handle}` : summary.profile.name;

export function formatRate(rate: number): string {
  const percent = rate * 100;
  return `${percent >= 10 ? Math.round(percent) : formatDecimal(Number(percent.toPrecision(2)))}%`;
}

function times(ratio: number): string {
  return ratio >= 1.95 ? `${formatDecimal(Math.round(ratio * 10) / 10)}×` : '';
}

/** Up to four plain sentences, each a comparison someone can act on. */
function headlines(view: MarketerView): string[] {
  const lines: string[] = [];
  const own = view.profiles.filter((p) => p.own);
  const watched = view.profiles.filter((p) => !p.own);
  const mainOwn = own[0];

  // Engagement: the number that says whether content lands.
  const watchedRates = watched.flatMap((p) =>
    p.engagementRate === null ? [] : [p.engagementRate],
  );
  const watchedRate = median(watchedRates);
  if (mainOwn?.engagementRate != null && watchedRate !== null) {
    const ratio = mainOwn.engagementRate / watchedRate;
    const verdict =
      ratio >= 1.15
        ? 'Your content is landing better than theirs.'
        : ratio <= 0.85
          ? 'Theirs is landing better; see their top posts below for what to try.'
          : 'You’re about level.';
    lines.push(
      `A typical post of yours gets likes and comments from ${formatRate(mainOwn.engagementRate)} of your followers; the profiles you watch get ${formatRate(watchedRate)}. ${verdict}`,
    );
  }

  // Posting rhythm.
  const watchedWeekly = median(
    watched.flatMap((p) => (p.frequency.status === 'ok' ? [p.frequency.postsPerWeek] : [])),
  );
  if (mainOwn?.frequency.status === 'ok' && watchedWeekly !== null) {
    const mine = mainOwn.frequency.postsPerWeek;
    const gap =
      mine < watchedWeekly * 0.75
        ? ' You may be posting too little to stay in their feeds.'
        : mine > watchedWeekly * 1.5
          ? ' You out-post them, so make sure each post earns its slot.'
          : '';
    lines.push(
      `You post ${formatDecimal(round1(mine))} times a week; they post ${formatDecimal(round1(watchedWeekly))} (median).${gap}`,
    );
  }

  // Best format among watched posts.
  const [best, ...rest] = view.formats;
  if (best && rest.length) {
    const others = median(rest.map((f) => f.medianRate))!;
    const ratio = others > 0 ? best.medianRate / others : null;
    const lift = ratio ? times(ratio) : '';
    lines.push(
      lift
        ? `${best.label} posts do best for the profiles you watch: ${lift} the engagement of their other formats (${best.posts} posts). Worth testing more of them.`
        : `${best.label} posts do slightly best for the profiles you watch (${best.posts} posts), but no format clearly wins.`,
    );
  }

  // Audience size, as context.
  const biggest = watched.find((p) => p.followers !== null);
  if (mainOwn?.followers != null && biggest?.followers != null) {
    const ratio = biggest.followers / mainOwn.followers;
    lines.push(
      ratio >= 1.2
        ? `${name(biggest)} has ${formatCompact(biggest.followers)} followers, ${times(ratio) || 'more than'} your ${formatCompact(mainOwn.followers)}. Compare engagement rates, not raw likes.`
        : `You have ${formatCompact(mainOwn.followers)} followers, as many as or more than any profile you watch.`,
    );
  }

  if (!mainOwn) {
    lines.push(
      'Add your own profile (business role "Own profile") to see how you compare with the profiles you watch.',
    );
  }
  return lines;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
