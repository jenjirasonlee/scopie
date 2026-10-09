import { z } from 'zod';
import {
  AuthError,
  PermissionError,
  PlatformError,
  RateLimitError,
  ValidationError,
} from '../errors';
import { fetchWithRetry, redactText, type HttpOptions } from '../http';
import type {
  NormalizedAccountMetric,
  NormalizedPost,
  NormalizedPostMetric,
  PublicContext,
  PublicObservation,
  PublicPostPage,
  PublicProfile,
  PublicProfileCollector,
  RawPayload,
} from '../types';

/**
 * Public YouTube channels through the YouTube Data API v3 with an API key. No OAuth and no
 * Meta: any public channel can be read. Only fields the API returns are used; a hidden
 * subscriber count, hidden likes or disabled comments are reported as such, never as 0.
 * https://developers.google.com/youtube/v3/docs/channels/list
 * https://developers.google.com/youtube/v3/docs/videos#statistics
 *
 * Quota: each call below costs 1 unit (10,000 units a day by default). An observation costs
 * 3 units: channel, one page of uploads, statistics for that page.
 */

const PLATFORM = 'youtube';
const BASE = 'https://www.googleapis.com/youtube/v3';
export const YOUTUBE_PAGE_SIZE = 50;

/** @handle (3-30 letters, digits, periods, hyphens, underscores) or a channel id (UC…). */
export const YOUTUBE_HANDLE = /^[A-Za-z0-9._-]{3,30}$/;
export const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

export function normalizeYouTubeHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.|m\.)?youtube\.com\//i, '')
    .replace(/^channel\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '');
}

const channelSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({
          title: z.string(),
          description: z.string().optional(),
          customUrl: z.string().optional(),
          thumbnails: z.object({ default: z.object({ url: z.string() }).optional() }).optional(),
        }),
        statistics: z
          .object({
            viewCount: z.string().optional(),
            subscriberCount: z.string().optional(),
            hiddenSubscriberCount: z.boolean().optional(),
            videoCount: z.string().optional(),
          })
          .optional(),
        contentDetails: z
          .object({ relatedPlaylists: z.object({ uploads: z.string().optional() }) })
          .optional(),
      }),
    )
    .optional(),
});

const playlistSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z.array(
    z.object({
      contentDetails: z.object({
        videoId: z.string(),
        videoPublishedAt: z.string().optional(),
      }),
    }),
  ),
});

const videosSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z.object({
        publishedAt: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        liveBroadcastContent: z.string().optional(),
      }),
      statistics: z
        .object({
          viewCount: z.string().optional(),
          likeCount: z.string().optional(),
          commentCount: z.string().optional(),
        })
        .optional(),
      status: z.object({ privacyStatus: z.string().optional() }).optional(),
    }),
  ),
});

type Channel = NonNullable<z.infer<typeof channelSchema>['items']>[number];
type Video = z.infer<typeof videosSchema>['items'][number];

/** The handle is not a public YouTube channel the API can read. Not retried. */
export class ChannelNotFoundError extends PlatformError {
  constructor(handle: string) {
    super(`YouTube has no public channel "@${handle}".`, 'profile_not_found');
    this.name = 'ChannelNotFoundError';
  }
}

function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(
      `Unexpected YouTube ${what} response: ${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim(),
    );
  }
  return result.data;
}

/** A count from the API (sent as a string), or null when the API left it out. */
function count(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new ValidationError(`Invalid count "${value}"`);
  return parsed;
}

type ErrorBody = { error?: { code?: number; message?: string; errors?: { reason?: string }[] } };

export function toYouTubeError(status: number, body: ErrorBody): PlatformError {
  const reason = body.error?.errors?.[0]?.reason ?? '';
  const message = redactText(body.error?.message ?? `YouTube API error (HTTP ${status})`);
  if (
    ['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded'].includes(reason) ||
    status === 429
  ) {
    // The daily quota resets at midnight Pacific time; an hour's wait is retried until then.
    return new RateLimitError(3600, 'YouTube API quota used up for today');
  }
  if (
    ['keyInvalid', 'keyExpired'].includes(reason) ||
    (status === 400 && /API key/i.test(message))
  ) {
    return new AuthError('The YouTube API key was rejected');
  }
  if (status === 403) return new PermissionError(message);
  return new PlatformError(message, 'platform_error', status);
}

function toPost(video: Video): NormalizedPost {
  return {
    externalId: video.id,
    publishedAt: new Date(video.snippet.publishedAt).toISOString(),
    permalink: `https://www.youtube.com/watch?v=${video.id}`,
    caption: [video.snippet.title, video.snippet.description].filter(Boolean).join('\n\n') || null,
    // The API doesn't say whether a video is a Short, so it is not guessed.
    mediaFormat: video.snippet.liveBroadcastContent === 'live' ? 'live' : 'video',
    nativeType: 'youtube#video',
  };
}

/** Views, likes and comments as returned; hidden likes and disabled comments say so. */
export function youtubeVideoMetrics(video: Video): NormalizedPostMetric[] {
  const base = { postExternalId: video.id, period: 'lifetime' as const, metricDate: null };
  const stats = video.statistics ?? {};
  const metric = (
    metricKey: string,
    sourceMetric: string,
    value: number | null,
    missing: 'hidden_by_owner' | 'not_public',
  ): NormalizedPostMetric =>
    value === null
      ? { ...base, metricKey, sourceMetric, value: null, availability: missing }
      : { ...base, metricKey, sourceMetric, value, availability: 'available' };
  return [
    metric('views', 'statistics.viewCount', count(stats.viewCount), 'not_public'),
    metric('likes', 'statistics.likeCount', count(stats.likeCount), 'hidden_by_owner'),
    // Missing when the owner turned comments off.
    metric('comments', 'statistics.commentCount', count(stats.commentCount), 'hidden_by_owner'),
  ];
}

function toProfile(channel: Channel): PublicProfile {
  return {
    externalId: channel.id,
    username: (channel.snippet.customUrl ?? channel.id).replace(/^@/, ''),
    displayName: channel.snippet.title,
    biography: channel.snippet.description || null,
    website: null,
    profilePictureUrl: channel.snippet.thumbnails?.default?.url ?? null,
  };
}

function totals(channel: Channel, asOf: string): NormalizedAccountMetric[] {
  const stats = channel.statistics ?? {};
  const metric = (
    metricKey: string,
    sourceMetric: string,
    value: number | null,
    missing: 'hidden_by_owner' | 'not_public',
  ): NormalizedAccountMetric =>
    value === null
      ? {
          metricKey,
          sourceMetric,
          value: null,
          availability: missing,
          period: 'lifetime',
          metricDate: asOf,
        }
      : {
          metricKey,
          sourceMetric,
          value,
          availability: 'available',
          period: 'lifetime',
          metricDate: asOf,
        };
  return [
    // YouTube rounds public subscriber counts down to three significant figures.
    metric(
      'followers',
      'statistics.subscriberCount',
      stats.hiddenSubscriberCount ? null : count(stats.subscriberCount),
      'hidden_by_owner',
    ),
    metric('posts_total', 'statistics.videoCount', count(stats.videoCount), 'not_public'),
    metric('views', 'statistics.viewCount', count(stats.viewCount), 'not_public'),
  ];
}

export class YouTubePublicCollector implements PublicProfileCollector {
  readonly platformKey = PLATFORM;
  private raw: RawPayload[] = [];
  private uploads = new Map<string, string>();
  /** Quota units spent by this collector. */
  unitsUsed = 0;

  constructor(private readonly options: HttpOptions = {}) {}

  drainRawPayloads(): RawPayload[] {
    const raw = this.raw;
    this.raw = [];
    return raw;
  }

  private async get(
    resource: string,
    params: Record<string, string>,
    ctx: PublicContext,
  ): Promise<unknown> {
    if (!ctx.credential) throw new PlatformError('No YouTube API key is configured', 'no_api_key');
    const url = new URL(`${BASE}/${resource}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    // The key goes in a header, so it never appears in a URL that could be logged.
    const response = await fetchWithRetry(
      url.toString(),
      { method: 'GET', headers: { 'X-Goog-Api-Key': ctx.credential } },
      this.options,
    );
    this.unitsUsed += 1;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ValidationError(`YouTube returned a non-JSON response for ${resource}`);
    }
    if (!response.ok) throw toYouTubeError(response.status, body as ErrorBody);
    this.raw.push({ endpoint: `GET ${resource}`, payload: body });
    return body;
  }

  private async channel(ctx: PublicContext, handle: string): Promise<Channel> {
    const value = normalizeYouTubeHandle(handle);
    const byId = YOUTUBE_CHANNEL_ID.test(value);
    if (!byId && !YOUTUBE_HANDLE.test(value)) throw new ChannelNotFoundError(value);
    const body = parse(
      channelSchema,
      await this.get(
        'channels',
        {
          part: 'snippet,statistics,contentDetails',
          ...(byId ? { id: value } : { forHandle: `@${value}` }),
        },
        ctx,
      ),
      'channel',
    );
    const channel = body.items?.[0];
    if (!channel) throw new ChannelNotFoundError(value);
    const uploads = channel.contentDetails?.relatedPlaylists.uploads;
    if (uploads) this.uploads.set(value.toLowerCase(), uploads);
    return channel;
  }

  private async page(ctx: PublicContext, uploads: string | undefined, cursor: string | null) {
    if (!uploads) return { posts: [], metrics: [], nextCursor: null } satisfies PublicPostPage;
    const list = parse(
      playlistSchema,
      await this.get(
        'playlistItems',
        {
          part: 'contentDetails',
          playlistId: uploads,
          maxResults: String(YOUTUBE_PAGE_SIZE),
          ...(cursor ? { pageToken: cursor } : {}),
        },
        ctx,
      ),
      'uploads',
    );
    const ids = list.items.map((item) => item.contentDetails.videoId);
    if (!ids.length) return { posts: [], metrics: [], nextCursor: null } satisfies PublicPostPage;
    const videos = parse(
      videosSchema,
      await this.get('videos', { part: 'snippet,statistics,status', id: ids.join(',') }, ctx),
      'videos',
    );
    // Upcoming premieres and scheduled streams have no stats yet; they are skipped until live.
    const published = videos.items.filter(
      (video) => video.snippet.liveBroadcastContent !== 'upcoming',
    );
    return {
      posts: published.map(toPost),
      metrics: published.flatMap(youtubeVideoMetrics),
      nextCursor: list.nextPageToken ?? null,
    } satisfies PublicPostPage;
  }

  async lookupProfile(ctx: PublicContext, handle: string) {
    const channel = await this.channel(ctx, handle);
    return {
      profile: toProfile(channel),
      accountMetrics: totals(channel, new Date().toISOString().slice(0, 10)),
    };
  }

  async observeProfile(
    ctx: PublicContext,
    handle: string,
    asOf: string,
  ): Promise<PublicObservation> {
    const channel = await this.channel(ctx, handle);
    return {
      profile: toProfile(channel),
      accountMetrics: totals(channel, asOf),
      firstPage: await this.page(ctx, channel.contentDetails?.relatedPlaylists.uploads, null),
    };
  }

  async listPosts(ctx: PublicContext, handle: string, cursor: string | null) {
    const key = normalizeYouTubeHandle(handle).toLowerCase();
    let uploads = this.uploads.get(key);
    if (!uploads)
      uploads = (await this.channel(ctx, handle)).contentDetails?.relatedPlaylists.uploads;
    return this.page(ctx, uploads, cursor);
  }
}
