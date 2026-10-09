import { z } from 'zod';
import { applyTransform, findMapping } from '@/lib/metrics/registry';
import { PermissionError, PlatformError } from '../errors';
import type {
  AccountContext,
  AccountMetricRange,
  MediaFormat,
  MetricAvailability,
  NormalizedAccountMetric,
  NormalizedPost,
  NormalizedPostMetric,
  PlatformAdapter,
  PostMetricsResult,
  PostPage,
  RawPayload,
} from '../types';
import { GraphClient, type GraphClientOptions } from './graph';
import {
  addDays,
  eachDay,
  insightsResponseSchema,
  metaReportDate,
  nextCursor,
  pagingSchema,
  parseGraph,
  singleInsightValue,
  unixDay,
  type Insight,
} from './shared';

const PLATFORM = 'instagram';

const mediaSchema = z.object({
  id: z.string(),
  caption: z.string().optional(),
  media_type: z.string(),
  media_product_type: z.string().optional(),
  permalink: z.string().optional(),
  timestamp: z.string(),
  children: z
    .object({ data: z.array(z.object({ id: z.string(), media_type: z.string() })) })
    .optional(),
});

const mediaPageSchema = z.object({ data: z.array(mediaSchema), paging: pagingSchema });
const profileSchema = z.object({ id: z.string(), followers_count: z.number().optional() });

const DAILY_TOTAL_METRICS = ['reach', 'views', 'profile_views', 'total_interactions'];
const FEED_POST_METRICS = [
  'reach',
  'views',
  'likes',
  'comments',
  'shares',
  'saved',
  'total_interactions',
];
const REEL_EXTRA_METRICS = ['ig_reels_video_view_total_time', 'ig_reels_avg_watch_time'];
const STORY_POST_METRICS = ['reach', 'views', 'shares', 'total_interactions'];

export function instagramMediaFormat(mediaType: string, productType?: string): MediaFormat {
  if (productType === 'STORY') return 'story';
  if (productType === 'REELS') return 'short_video';
  if (mediaType === 'CAROUSEL_ALBUM') return 'carousel';
  if (mediaType === 'IMAGE') return 'image';
  if (mediaType === 'VIDEO') return 'video';
  return 'other';
}

export function postMetricsFor(format: MediaFormat): string[] {
  if (format === 'story') return STORY_POST_METRICS;
  if (format === 'short_video') return [...FEED_POST_METRICS, ...REEL_EXTRA_METRICS];
  return FEED_POST_METRICS;
}

function availabilityFor(error: unknown): MetricAvailability {
  return error instanceof PermissionError ? 'not_permitted' : 'error';
}

/** Re-throws errors that must stop the job (auth, rate limit, network). */
function isMetricLevelError(error: unknown): boolean {
  return (
    error instanceof PermissionError ||
    (error instanceof PlatformError && error.code === 'invalid_parameter')
  );
}

export class InstagramAdapter implements PlatformAdapter {
  readonly platformKey = PLATFORM;
  private readonly graph: GraphClient;
  private raw: RawPayload[] = [];

  constructor(options: GraphClientOptions = {}) {
    this.graph = new GraphClient({
      ...options,
      onResponse: (endpoint, payload) => {
        this.raw.push({ endpoint, payload });
        options.onResponse?.(endpoint, payload);
      },
    });
  }

  drainRawPayloads(): RawPayload[] {
    const drained = this.raw;
    this.raw = [];
    return drained;
  }

  /**
   * Requests several insight metrics at once; when Meta rejects the set because one
   * metric isn't available for this account or post, retries them one by one so the
   * others still arrive. Each failed metric is reported with its reason.
   */
  private async insights(
    path: string,
    metrics: string[],
    params: Record<string, string | number>,
    token: string,
  ): Promise<{ insights: Insight[]; failed: Map<string, MetricAvailability> }> {
    const failed = new Map<string, MetricAvailability>();
    try {
      const body = await this.graph.get(path, { metric: metrics.join(','), ...params }, token);
      return { insights: parseGraph(insightsResponseSchema, body, 'insights').data, failed };
    } catch (error) {
      if (!isMetricLevelError(error)) throw error;
      if (metrics.length === 1) {
        failed.set(metrics[0]!, availabilityFor(error));
        return { insights: [], failed };
      }
    }
    const insights: Insight[] = [];
    for (const metric of metrics) {
      const single = await this.insights(path, [metric], params, token);
      insights.push(...single.insights);
      for (const [name, reason] of single.failed) failed.set(name, reason);
    }
    return { insights, failed };
  }

  async getAccountMetrics(
    ctx: AccountContext,
    range: AccountMetricRange,
  ): Promise<NormalizedAccountMetric[]> {
    const out: NormalizedAccountMetric[] = [];
    const account = (sourceMetric: string) => findMapping(PLATFORM, 'account', sourceMetric)!;

    // Running total: only today's value exists, so it is recorded as of the last day.
    const profile = parseGraph(
      profileSchema,
      await this.graph.get(ctx.externalId, { fields: 'followers_count' }, ctx.accessToken),
      'profile',
    );
    out.push({
      metricKey: account('followers_count').metricKey,
      sourceMetric: 'followers_count',
      value: profile.followers_count ?? null,
      availability: profile.followers_count === undefined ? 'error' : 'available',
      period: 'lifetime',
      metricDate: range.asOf,
    });

    // Daily new followers as a time series.
    const gained = await this.insights(
      `${ctx.externalId}/insights`,
      ['follower_count'],
      { period: 'day', since: unixDay(range.since), until: unixDay(addDays(range.until, 1)) },
      ctx.accessToken,
    );
    const gainedByDay = new Map<string, number>();
    for (const value of gained.insights[0]?.values ?? []) {
      if (value.end_time && typeof value.value === 'number') {
        gainedByDay.set(metaReportDate(value.end_time), value.value);
      }
    }
    for (const day of eachDay(range.since, range.until)) {
      const value = gainedByDay.get(day);
      const failedReason = gained.failed.get('follower_count');
      out.push({
        metricKey: account('follower_count').metricKey,
        sourceMetric: 'follower_count',
        value: failedReason ? null : (value ?? null),
        availability: failedReason ?? (value === undefined ? 'pending' : 'available'),
        period: 'day',
        metricDate: day,
      });
    }

    // Totals per day. Meta returns one total per request, so each day is asked separately.
    for (const day of eachDay(range.since, range.until)) {
      const result = await this.insights(
        `${ctx.externalId}/insights`,
        DAILY_TOTAL_METRICS,
        {
          metric_type: 'total_value',
          period: 'day',
          since: unixDay(day),
          until: unixDay(addDays(day, 1)),
        },
        ctx.accessToken,
      );
      for (const sourceMetric of DAILY_TOTAL_METRICS) {
        const insight = result.insights.find((entry) => entry.name === sourceMetric);
        const value = insight ? singleInsightValue(insight) : null;
        const failedReason = result.failed.get(sourceMetric);
        out.push({
          metricKey: account(sourceMetric).metricKey,
          sourceMetric,
          value: failedReason ? null : value,
          availability: failedReason ?? (value === null ? 'error' : 'available'),
          period: 'day',
          metricDate: day,
        });
      }
    }
    return out;
  }

  async listPosts(ctx: AccountContext, cursor: string | null): Promise<PostPage> {
    const body = await this.graph.get(
      `${ctx.externalId}/media`,
      {
        fields:
          'id,caption,media_type,media_product_type,permalink,timestamp,children{id,media_type}',
        limit: 50,
        after: cursor ?? undefined,
      },
      ctx.accessToken,
    );
    const page = parseGraph(mediaPageSchema, body, 'media list');
    const posts: NormalizedPost[] = page.data.map((media) => ({
      externalId: media.id,
      publishedAt: new Date(media.timestamp).toISOString(),
      permalink: media.permalink ?? null,
      caption: media.caption ?? null,
      mediaFormat: instagramMediaFormat(media.media_type, media.media_product_type),
      nativeType: [media.media_product_type, media.media_type].filter(Boolean).join('/'),
      media: (media.children?.data ?? []).map((child, position) => ({
        position,
        mediaType: child.media_type,
        externalId: child.id,
        durationSeconds: null,
      })),
    }));
    return { posts, nextCursor: nextCursor(page.paging) };
  }

  async getPostMetrics(
    ctx: AccountContext,
    posts: Pick<NormalizedPost, 'externalId' | 'mediaFormat' | 'nativeType'>[],
  ): Promise<PostMetricsResult> {
    const result: PostMetricsResult = { metrics: [], failures: [] };
    for (const post of posts) {
      const requested = postMetricsFor(post.mediaFormat);
      let fetched: Awaited<ReturnType<InstagramAdapter['insights']>>;
      try {
        fetched = await this.insights(
          `${post.externalId}/insights`,
          requested,
          {},
          ctx.accessToken,
        );
      } catch (error) {
        if (error instanceof PlatformError && !isRetryStopper(error)) {
          result.failures.push({ postExternalId: post.externalId, message: error.message });
          continue;
        }
        throw error;
      }
      for (const sourceMetric of requested) {
        const mapping = findMapping(PLATFORM, 'post', sourceMetric)!;
        const insight = fetched.insights.find((entry) => entry.name === sourceMetric);
        const raw = insight ? singleInsightValue(insight) : null;
        const failedReason = fetched.failed.get(sourceMetric);
        result.metrics.push({
          postExternalId: post.externalId,
          metricKey: mapping.metricKey,
          sourceMetric,
          value: failedReason || raw === null ? null : applyTransform(raw, mapping.valueTransform),
          availability: failedReason ?? (raw === null ? 'error' : 'available'),
          period: 'lifetime',
          metricDate: null,
        } satisfies NormalizedPostMetric);
      }
    }
    return result;
  }
}

/** Errors that must stop the whole job rather than skip one post. */
function isRetryStopper(error: PlatformError): boolean {
  return error.code === 'auth' || error.code === 'rate_limited' || error.code === 'transient';
}
