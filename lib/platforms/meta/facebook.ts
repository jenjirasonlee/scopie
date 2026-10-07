import { z } from 'zod';
import { findMapping } from '@/lib/metrics/registry';
import { PermissionError, PlatformError } from '../errors';
import type {
  AccountContext,
  AccountMetricRange,
  MediaFormat,
  MetricAvailability,
  NormalizedAccountMetric,
  NormalizedPost,
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
} from './shared';

const PLATFORM = 'facebook';

const pageSchema = z.object({ id: z.string(), followers_count: z.number().optional() });

const attachmentSchema = z.object({
  media_type: z.string().optional(),
  type: z.string().optional(),
  subattachments: z
    .object({ data: z.array(z.object({ media_type: z.string().optional() })) })
    .optional(),
});

const postSchema = z.object({
  id: z.string(),
  message: z.string().optional(),
  created_time: z.string(),
  permalink_url: z.string().optional(),
  status_type: z.string().optional(),
  attachments: z.object({ data: z.array(attachmentSchema) }).optional(),
});
const postsPageSchema = z.object({ data: z.array(postSchema), paging: pagingSchema });

const summarySchema = z
  .object({ summary: z.object({ total_count: z.number() }).optional() })
  .optional();
const postMetricsSchema = z.object({
  id: z.string(),
  reactions: summarySchema,
  comments: summarySchema,
  shares: z.object({ count: z.number() }).optional(),
  insights: insightsResponseSchema.optional(),
});

const PAGE_DAILY_METRICS = ['page_impressions_unique', 'page_post_engagements'];
const POST_INSIGHT_METRICS = ['post_impressions_unique', 'post_impressions', 'post_clicks'];

export function facebookMediaFormat(post: z.infer<typeof postSchema>): MediaFormat {
  const attachment = post.attachments?.data[0];
  const type = (attachment?.media_type ?? attachment?.type ?? '').toLowerCase();
  if (post.status_type === 'added_video' || type === 'video' || type.startsWith('video'))
    return 'video';
  if (type === 'album' || (attachment?.subattachments?.data.length ?? 0) > 1) return 'carousel';
  if (type === 'photo') return 'image';
  if (type === 'link' || type === 'share') return 'link';
  if (!attachment) return 'text';
  return 'other';
}

export class FacebookAdapter implements PlatformAdapter {
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

  async getAccountMetrics(
    ctx: AccountContext,
    range: AccountMetricRange,
  ): Promise<NormalizedAccountMetric[]> {
    const out: NormalizedAccountMetric[] = [];
    const page = parseGraph(
      pageSchema,
      await this.graph.get(ctx.externalId, { fields: 'followers_count' }, ctx.accessToken),
      'page',
    );
    out.push({
      metricKey: 'followers',
      sourceMetric: 'followers_count',
      value: page.followers_count ?? null,
      availability: page.followers_count === undefined ? 'error' : 'available',
      period: 'lifetime',
      metricDate: range.asOf,
    });

    for (const sourceMetric of PAGE_DAILY_METRICS) {
      const mapping = findMapping(PLATFORM, 'account', sourceMetric)!;
      const byDay = new Map<string, number>();
      let failedReason: MetricAvailability | null = null;
      try {
        const body = await this.graph.get(
          `${ctx.externalId}/insights`,
          {
            metric: sourceMetric,
            period: 'day',
            since: unixDay(range.since),
            until: unixDay(addDays(range.until, 1)),
          },
          ctx.accessToken,
        );
        const insight = parseGraph(insightsResponseSchema, body, 'page insights').data[0];
        for (const value of insight?.values ?? []) {
          if (value.end_time && typeof value.value === 'number') {
            byDay.set(metaReportDate(value.end_time), value.value);
          }
        }
      } catch (error) {
        if (error instanceof PermissionError) failedReason = 'not_permitted';
        else if (error instanceof PlatformError && error.code === 'invalid_parameter')
          failedReason = 'error';
        else throw error;
      }
      for (const day of eachDay(range.since, range.until)) {
        const value = byDay.get(day);
        out.push({
          metricKey: mapping.metricKey,
          sourceMetric,
          value: failedReason ? null : (value ?? null),
          availability: failedReason ?? (value === undefined ? 'pending' : 'available'),
          period: 'day',
          metricDate: day,
        });
      }
    }
    return out;
  }

  async listPosts(ctx: AccountContext, cursor: string | null): Promise<PostPage> {
    const body = await this.graph.get(
      `${ctx.externalId}/published_posts`,
      {
        fields:
          'id,message,created_time,permalink_url,status_type,attachments{media_type,type,subattachments}',
        limit: 50,
        after: cursor ?? undefined,
      },
      ctx.accessToken,
    );
    const page = parseGraph(postsPageSchema, body, 'page posts');
    const posts: NormalizedPost[] = page.data.map((post) => ({
      externalId: post.id,
      publishedAt: new Date(post.created_time).toISOString(),
      permalink: post.permalink_url ?? null,
      caption: post.message ?? null,
      mediaFormat: facebookMediaFormat(post),
      nativeType: post.status_type ?? null,
    }));
    return { posts, nextCursor: nextCursor(page.paging) };
  }

  async getPostMetrics(
    ctx: AccountContext,
    posts: Pick<NormalizedPost, 'externalId' | 'mediaFormat' | 'nativeType'>[],
  ): Promise<PostMetricsResult> {
    const result: PostMetricsResult = { metrics: [], failures: [] };
    for (const post of posts) {
      let parsed: z.infer<typeof postMetricsSchema>;
      try {
        const body = await this.graph.get(
          post.externalId,
          {
            fields: `reactions.summary(true).limit(0),comments.summary(true).limit(0),shares,insights.metric(${POST_INSIGHT_METRICS.join(',')})`,
          },
          ctx.accessToken,
        );
        parsed = parseGraph(postMetricsSchema, body, 'post metrics');
      } catch (error) {
        if (
          error instanceof PlatformError &&
          !['auth', 'rate_limited', 'transient'].includes(error.code)
        ) {
          result.failures.push({ postExternalId: post.externalId, message: error.message });
          continue;
        }
        throw error;
      }

      const push = (sourceMetric: string, value: number | null) => {
        const mapping = findMapping(PLATFORM, 'post', sourceMetric)!;
        result.metrics.push({
          postExternalId: post.externalId,
          metricKey: mapping.metricKey,
          sourceMetric,
          value,
          availability: value === null ? 'error' : 'available',
          period: 'lifetime',
          metricDate: null,
        });
      };
      push('reactions.summary.total_count', parsed.reactions?.summary?.total_count ?? null);
      push('comments.summary.total_count', parsed.comments?.summary?.total_count ?? null);
      // Facebook leaves out `shares` entirely when a post has none, so absence means zero here.
      push('shares.count', parsed.shares?.count ?? 0);
      for (const sourceMetric of POST_INSIGHT_METRICS) {
        const insight = parsed.insights?.data.find((entry) => entry.name === sourceMetric);
        push(sourceMetric, insight ? singleInsightValue(insight) : null);
      }
    }
    return result;
  }
}
