import type { Enums } from '@/lib/db/types';

export type MetricUnit = Enums<'metric_unit'>;
export type MetricAggregation = Enums<'metric_aggregation'>;
export type MetricScope = Enums<'metric_scope'>;

export type MetricDefinition = {
  key: string;
  label: string;
  unit: MetricUnit;
  aggregation: MetricAggregation;
  higherIsBetter: boolean;
  appliesToAccounts: boolean;
  appliesToPosts: boolean;
  isDerived: boolean;
  inputs: readonly string[];
};

/**
 * Scopie's metric dictionary. Mirror of public.metric_definitions
 * (supabase/migrations/…_data_pipeline.sql), which also holds the definitions and
 * formulas shown in the UI. tests/integration/pipeline.test.ts asserts both match.
 * See docs/METRICS.md for definitions, comparability and fallback rules.
 */
export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  m('followers', 'Followers', 'count', 'last', true, 'account'),
  m('followers_gained', 'Followers gained', 'count', 'sum', true, 'account'),
  m('following', 'Following', 'count', 'last', false, 'account'),
  m('posts_total', 'Posts on profile', 'count', 'last', true, 'account'),
  m('followers_lost', 'Followers lost', 'count', 'sum', false, 'account'),
  m('follower_change', 'Net follower change', 'count', 'sum', true, 'account', [
    'followers',
    'followers_gained',
    'followers_lost',
  ]),
  m('follower_growth_rate', 'Follower growth rate', 'percent', 'recompute', true, 'account', [
    'follower_change',
    'followers',
  ]),
  m('reach', 'Reach', 'count', 'not_additive', true, 'both'),
  m('impressions', 'Impressions', 'count', 'sum', true, 'both'),
  m('views', 'Views', 'count', 'sum', true, 'both'),
  m('profile_views', 'Profile views', 'count', 'sum', true, 'account'),
  m('likes', 'Likes', 'count', 'sum', true, 'post'),
  m('reactions', 'Reactions', 'count', 'sum', true, 'post'),
  m('comments', 'Comments', 'count', 'sum', true, 'post'),
  m('shares', 'Shares', 'count', 'sum', true, 'post'),
  m('quotes', 'Quotes', 'count', 'sum', true, 'post'),
  m('saves', 'Saves', 'count', 'sum', true, 'post'),
  m('link_clicks', 'Link clicks', 'count', 'sum', true, 'post'),
  m('interactions', 'Total interactions', 'count', 'sum', true, 'both'),
  m('watch_time', 'Watch time', 'seconds', 'sum', true, 'post'),
  m('avg_watch_duration', 'Average watch duration', 'seconds', 'recompute', true, 'post'),
  m('completion_rate', 'Completion rate', 'percent', 'not_additive', true, 'post'),
  m('posts_published', 'Posts published', 'count', 'sum', true, 'account', []),
  m('engagement_rate_reach', 'Engagement rate (by reach)', 'percent', 'recompute', true, 'post', [
    'interactions',
    'reach',
  ]),
  m('engagement_rate_views', 'Engagement rate (by views)', 'percent', 'recompute', true, 'post', [
    'interactions',
    'views',
  ]),
  m(
    'engagement_rate_followers',
    'Engagement rate (by followers)',
    'percent',
    'recompute',
    true,
    'post',
    ['interactions', 'followers'],
  ),
  m('public_engagement', 'Public engagement', 'count', 'sum', true, 'post', ['likes', 'comments']),
];

function m(
  key: string,
  label: string,
  unit: MetricUnit,
  aggregation: MetricAggregation,
  higherIsBetter: boolean,
  scope: 'account' | 'post' | 'both',
  derivedFrom?: string[],
): MetricDefinition {
  return {
    key,
    label,
    unit,
    aggregation,
    higherIsBetter,
    appliesToAccounts: scope !== 'post',
    appliesToPosts: scope !== 'account',
    isDerived: derivedFrom !== undefined,
    inputs: derivedFrom ?? [],
  };
}

const BY_KEY = new Map(METRIC_DEFINITIONS.map((definition) => [definition.key, definition]));

export function getMetric(key: string): MetricDefinition | undefined {
  return BY_KEY.get(key);
}

/** True when a platform, import or the demo generator may store this metric for this scope. */
export function isStorableMetric(key: string, scope: MetricScope): boolean {
  const definition = BY_KEY.get(key);
  if (!definition || definition.isDerived) return false;
  return scope === 'account' ? definition.appliesToAccounts : definition.appliesToPosts;
}

export type PlatformMetricMapping = {
  platformKey: string;
  scope: MetricScope;
  sourceMetric: string;
  metricKey: string;
  comparabilityClass: string;
  valueTransform: 'ms_to_seconds' | null;
};

/**
 * Which platform metric feeds which Scopie metric, and its comparability class.
 * Two values may be compared or summed only when their classes match.
 * Mirror of public.platform_metric_map; connectors read it, the UI reads the table.
 */
export const PLATFORM_METRIC_MAP: readonly PlatformMetricMapping[] = [
  pm('instagram', 'account', 'followers_count', 'followers', 'audience_size'),
  pm('instagram', 'account', 'follower_count', 'followers_gained', 'meta_followers_gained'),
  pm('instagram', 'account', 'reach', 'reach', 'meta_reach'),
  pm('instagram', 'account', 'views', 'views', 'meta_views'),
  pm('instagram', 'account', 'profile_views', 'profile_views', 'ig_profile_views'),
  pm('instagram', 'account', 'total_interactions', 'interactions', 'meta_interactions'),
  pm('instagram', 'post', 'reach', 'reach', 'meta_reach'),
  pm('instagram', 'post', 'views', 'views', 'meta_views'),
  pm('instagram', 'post', 'likes', 'likes', 'likes'),
  pm('instagram', 'post', 'comments', 'comments', 'comments'),
  pm('instagram', 'post', 'shares', 'shares', 'shares'),
  pm('instagram', 'post', 'saved', 'saves', 'ig_saves'),
  pm('instagram', 'post', 'total_interactions', 'interactions', 'meta_interactions'),
  pm(
    'instagram',
    'post',
    'ig_reels_video_view_total_time',
    'watch_time',
    'ig_reels_watch_time',
    'ms_to_seconds',
  ),
  pm(
    'instagram',
    'post',
    'ig_reels_avg_watch_time',
    'avg_watch_duration',
    'ig_reels_watch_time',
    'ms_to_seconds',
  ),
  // Public data from Business Discovery (no owner authorization).
  pm('instagram', 'account', 'business_discovery.followers_count', 'followers', 'audience_size'),
  pm('instagram', 'account', 'business_discovery.media_count', 'posts_total', 'posts_total'),
  pm('instagram', 'post', 'business_discovery.like_count', 'likes', 'likes'),
  pm('instagram', 'post', 'business_discovery.comments_count', 'comments', 'comments'),
  // Includes paid views, so never compared with the insights "views".
  pm('instagram', 'post', 'business_discovery.view_count', 'views', 'ig_public_reel_views'),
  // Public YouTube data (API key). Subscriber counts are rounded by YouTube.
  pm('youtube', 'account', 'statistics.subscriberCount', 'followers', 'yt_subscribers_rounded'),
  pm('youtube', 'account', 'statistics.videoCount', 'posts_total', 'posts_total'),
  pm('youtube', 'account', 'statistics.viewCount', 'views', 'yt_channel_views'),
  pm('youtube', 'post', 'statistics.viewCount', 'views', 'yt_public_views'),
  pm('youtube', 'post', 'statistics.likeCount', 'likes', 'likes'),
  pm('youtube', 'post', 'statistics.commentCount', 'comments', 'comments'),
  // Public X data (API v2, app-only Bearer token). X shows impressions as "views".
  pm('x', 'account', 'public_metrics.followers_count', 'followers', 'audience_size'),
  pm('x', 'account', 'public_metrics.following_count', 'following', 'following'),
  // Includes replies and reposts, unlike other platforms' post counts.
  pm('x', 'account', 'public_metrics.tweet_count', 'posts_total', 'x_tweet_count'),
  pm('x', 'post', 'public_metrics.like_count', 'likes', 'likes'),
  pm('x', 'post', 'public_metrics.reply_count', 'comments', 'comments'),
  pm('x', 'post', 'public_metrics.retweet_count', 'shares', 'reposts'),
  pm('x', 'post', 'public_metrics.quote_count', 'quotes', 'quotes'),
  pm('x', 'post', 'public_metrics.bookmark_count', 'saves', 'x_bookmarks'),
  pm('x', 'post', 'public_metrics.impression_count', 'views', 'x_public_views'),
  // Public Bluesky data (AppView, no key).
  pm('bluesky', 'account', 'followersCount', 'followers', 'audience_size'),
  pm('bluesky', 'account', 'followsCount', 'following', 'following'),
  pm('bluesky', 'account', 'postsCount', 'posts_total', 'bsky_posts_count'),
  pm('bluesky', 'post', 'likeCount', 'likes', 'likes'),
  pm('bluesky', 'post', 'replyCount', 'comments', 'comments'),
  pm('bluesky', 'post', 'repostCount', 'shares', 'reposts'),
  pm('bluesky', 'post', 'quoteCount', 'quotes', 'quotes'),
  pm('facebook', 'account', 'followers_count', 'followers', 'audience_size'),
  pm('facebook', 'account', 'page_impressions_unique', 'reach', 'meta_reach'),
  pm('facebook', 'account', 'page_post_engagements', 'interactions', 'fb_page_engagements'),
  pm('facebook', 'post', 'post_impressions_unique', 'reach', 'meta_reach'),
  pm('facebook', 'post', 'post_impressions', 'impressions', 'fb_impressions'),
  pm('facebook', 'post', 'reactions.summary.total_count', 'reactions', 'fb_reactions'),
  pm('facebook', 'post', 'comments.summary.total_count', 'comments', 'comments'),
  pm('facebook', 'post', 'shares.count', 'shares', 'shares'),
  pm('facebook', 'post', 'post_clicks', 'link_clicks', 'fb_clicks'),
];

function pm(
  platformKey: string,
  scope: MetricScope,
  sourceMetric: string,
  metricKey: string,
  comparabilityClass: string,
  valueTransform: 'ms_to_seconds' | null = null,
): PlatformMetricMapping {
  return { platformKey, scope, sourceMetric, metricKey, comparabilityClass, valueTransform };
}

export function platformMetrics(platformKey: string, scope: MetricScope): PlatformMetricMapping[] {
  return PLATFORM_METRIC_MAP.filter(
    (mapping) => mapping.platformKey === platformKey && mapping.scope === scope,
  );
}

export function findMapping(
  platformKey: string,
  scope: MetricScope,
  sourceMetric: string,
): PlatformMetricMapping | undefined {
  return PLATFORM_METRIC_MAP.find(
    (mapping) =>
      mapping.platformKey === platformKey &&
      mapping.scope === scope &&
      mapping.sourceMetric === sourceMetric,
  );
}

/**
 * Comparability class of a metric on a platform. Pass the source metric when known: one
 * Scopie metric can come from sources that are not comparable (Instagram public Reel views
 * include paid views; insights views don't). Metrics without a mapping (e.g. imported
 * LinkedIn numbers) are only comparable within their own platform.
 */
export function comparabilityClass(
  platformKey: string,
  scope: MetricScope,
  metricKey: string,
  sourceMetric?: string,
): string {
  const mapping = PLATFORM_METRIC_MAP.find(
    (entry) =>
      entry.platformKey === platformKey &&
      entry.scope === scope &&
      entry.metricKey === metricKey &&
      (sourceMetric === undefined || entry.sourceMetric === sourceMetric),
  );
  return mapping?.comparabilityClass ?? `${platformKey}:${metricKey}`;
}

export function applyTransform(
  value: number,
  transform: PlatformMetricMapping['valueTransform'],
): number {
  return transform === 'ms_to_seconds' ? value / 1000 : value;
}
