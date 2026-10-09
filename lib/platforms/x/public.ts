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
  MediaFormat,
  NormalizedAccountMetric,
  NormalizedPost,
  NormalizedPostMetric,
  PublicContext,
  PublicObservation,
  PublicPostPage,
  PublicProfile,
  PublicProfileCollector,
  PublicReadPlan,
  RawPayload,
} from '../types';

/**
 * Public X profiles through the official X API v2 with an app-only Bearer token. No login
 * from the profile owner: any public (not protected) account can be read. Only public
 * fields are used; a metric the API leaves out is reported as such, never as 0.
 * https://docs.x.com/x-api/users/user-lookup-by-username
 * https://docs.x.com/x-api/users/get-posts
 * https://docs.x.com/x-api/posts/post-lookup-by-post-ids
 *
 * Cost: X bills per resource read (about $0.010 per user and $0.005 per post, each counted
 * once per UTC day). So an observation reads the profile, only the posts newer than the
 * newest one stored, and re-reads stored posts that are due a snapshot, at most
 * X_MAX_POSTS_PER_RUN posts in total. There is no refresh or backfill job for X.
 *
 * Deleted content: X's developer terms require deleting content that was deleted on X. A
 * re-read post that X no longer returns is reported in `removedPostIds`, and the sync job
 * deletes it with its metrics. Post text is never kept in the raw payloads.
 */

const PLATFORM = 'x';
const BASE = 'https://api.x.com/2';

/** Posts read per profile per run, new and re-read together. Caps the cost of one observation. */
export const X_MAX_POSTS_PER_RUN = 50;
/** The posts endpoint returns 5 to 100 posts per request. */
const X_MIN_PAGE = 5;
/** Timeline requests per observation (X can return short pages when filtering). */
const X_MAX_REQUESTS = 3;
/** On the first observation, posts are read back this far (within the cap). */
export const X_FIRST_READ_DAYS = 30;
/** Approximate price per resource read, in US dollars (developer.x.com pricing, pay-per-use). */
export const X_PRICE_USD = { user: 0.01, post: 0.005 } as const;

/** X usernames: 1-15 letters, digits and underscores. */
export const X_USERNAME = /^[A-Za-z0-9_]{1,15}$/;
export const X_USER_ID = /^\d{1,20}$/;

/** Accepts @name, name, or an x.com / twitter.com profile link. */
export function normalizeXHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '');
}

const USER_FIELDS =
  'public_metrics,description,profile_image_url,url,verified,protected,created_at,name,entities';
const TWEET_PARAMS = {
  'tweet.fields': 'created_at,public_metrics,attachments,entities,referenced_tweets',
  expansions: 'attachments.media_keys',
  'media.fields': 'type',
};

const problemSchema = z.object({
  title: z.string().optional(),
  detail: z.string().optional(),
  type: z.string().optional(),
  value: z.string().optional(),
  resource_id: z.string().optional(),
});

const userSchema = z.object({
  data: z
    .object({
      id: z.string(),
      username: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      profile_image_url: z.string().optional(),
      url: z.string().optional(),
      protected: z.boolean().optional(),
      entities: z
        .object({
          url: z
            .object({
              urls: z.array(z.object({ expanded_url: z.string().optional() })).optional(),
            })
            .optional(),
        })
        .optional(),
      public_metrics: z
        .object({
          followers_count: z.number().optional(),
          following_count: z.number().optional(),
          tweet_count: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  errors: z.array(problemSchema).optional(),
});

const tweetSchema = z.object({
  id: z.string(),
  text: z.string().optional(),
  created_at: z.string(),
  public_metrics: z
    .object({
      retweet_count: z.number().optional(),
      reply_count: z.number().optional(),
      like_count: z.number().optional(),
      quote_count: z.number().optional(),
      bookmark_count: z.number().optional(),
      impression_count: z.number().optional(),
    })
    .optional(),
  attachments: z.object({ media_keys: z.array(z.string()).optional() }).optional(),
  referenced_tweets: z.array(z.object({ type: z.string(), id: z.string() })).optional(),
});

const tweetsSchema = z.object({
  data: z.array(tweetSchema).optional(),
  includes: z
    .object({ media: z.array(z.object({ media_key: z.string(), type: z.string() })).optional() })
    .optional(),
  meta: z.object({ next_token: z.string().optional() }).optional(),
  errors: z.array(problemSchema).optional(),
});

type User = NonNullable<z.infer<typeof userSchema>['data']>;
type Tweet = z.infer<typeof tweetSchema>;
type Tweets = z.infer<typeof tweetsSchema>;

/** The username is not an X account the API returns. Not retried. */
export class XProfileNotFoundError extends PlatformError {
  constructor(handle: string, detail?: string) {
    super(detail ?? `X has no public account "@${handle}".`, 'profile_not_found');
    this.name = 'XProfileNotFoundError';
  }
}

/** A protected account: its posts are visible only to approved followers. Not read. */
export class XProtectedProfileError extends PlatformError {
  constructor(handle: string) {
    super(
      `@${handle} is a protected X account, so it has no public data. Scopie doesn't read it.`,
      'profile_protected',
    );
    this.name = 'XProtectedProfileError';
  }
}

/** The X developer account has no credits left. Reading resumes after credits are bought. */
export class XCreditsDepletedError extends RateLimitError {
  constructor() {
    super(
      24 * 60 * 60,
      'X credits are used up. Buy more pay-per-use credits at developer.x.com; X profiles are read again after that.',
    );
    this.name = 'XCreditsDepletedError';
  }
  override readonly code = 'credits_depleted';
}

function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(
      `Unexpected X ${what} response: ${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim(),
    );
  }
  return result.data;
}

type Problem = z.infer<typeof problemSchema> & { status?: number; errors?: Problem[] };

function isNotFound(problem: Problem | undefined): boolean {
  if (!problem) return false;
  return (
    /resource-not-found/.test(problem.type ?? '') ||
    /not found/i.test(problem.title ?? '') ||
    /could not find|deleted/i.test(problem.detail ?? '')
  );
}

/** Maps an X API error response to a typed error. Messages never contain the token. */
export function toXError(status: number, body: Problem, headers: Headers): PlatformError {
  const problem = body.errors?.[0] ?? body;
  const text = `${problem.title ?? ''} ${problem.type ?? ''} ${problem.detail ?? ''}`;
  const message = redactText(problem.detail ?? problem.title ?? `X API error (HTTP ${status})`);
  if (status === 402 || /credit/i.test(text)) return new XCreditsDepletedError();
  if (status === 429) {
    const reset = Number(headers.get('x-rate-limit-reset'));
    const wait = Number.isFinite(reset) && reset > 0 ? Math.ceil(reset - Date.now() / 1000) : 900;
    return new RateLimitError(Math.max(60, wait), 'X rate limit reached');
  }
  if (status === 401) return new AuthError('The X API key (Bearer token) was rejected');
  if (status === 403) return new PermissionError(`X refused the request: ${message}`);
  if (status === 404 || isNotFound(problem)) {
    return new PlatformError(`X says: ${message}`, 'not_found', status);
  }
  return new PlatformError(message, 'platform_error', status);
}

/** photo → image; video or GIF → video; no media → text. */
export function xMediaFormat(tweet: Tweet, media: Map<string, string>): MediaFormat {
  const types = (tweet.attachments?.media_keys ?? []).map((key) => media.get(key));
  if (types.some((type) => type === 'video' || type === 'animated_gif')) return 'video';
  if (types.some((type) => type === 'photo')) return 'image';
  return 'text';
}

function toPost(tweet: Tweet, username: string, media: Map<string, string>): NormalizedPost {
  const quoted = tweet.referenced_tweets?.some((ref) => ref.type === 'quoted');
  return {
    externalId: tweet.id,
    publishedAt: new Date(tweet.created_at).toISOString(),
    permalink: `https://x.com/${username}/status/${tweet.id}`,
    caption: tweet.text || null,
    mediaFormat: xMediaFormat(tweet, media),
    nativeType: quoted ? 'quote' : 'tweet',
  };
}

/** Public per-post counts as returned; a count X leaves out is unavailable, not 0. */
export function xPostMetrics(tweet: Tweet): NormalizedPostMetric[] {
  const base = { postExternalId: tweet.id, period: 'lifetime' as const, metricDate: null };
  const stats = tweet.public_metrics ?? {};
  const metric = (metricKey: string, field: keyof typeof stats): NormalizedPostMetric => {
    const value = stats[field];
    const sourceMetric = `public_metrics.${field}`;
    return value === undefined
      ? { ...base, metricKey, sourceMetric, value: null, availability: 'not_public' }
      : { ...base, metricKey, sourceMetric, value, availability: 'available' };
  };
  return [
    metric('likes', 'like_count'),
    metric('comments', 'reply_count'),
    metric('shares', 'retweet_count'),
    metric('quotes', 'quote_count'),
    metric('saves', 'bookmark_count'),
    // X shows impressions as "views"; stored as views in their own comparability class.
    metric('views', 'impression_count'),
  ];
}

function toProfile(user: User): PublicProfile {
  return {
    externalId: user.id,
    username: user.username,
    displayName: user.name ?? null,
    biography: user.description || null,
    website: user.entities?.url?.urls?.[0]?.expanded_url ?? user.url ?? null,
    profilePictureUrl: user.profile_image_url ?? null,
  };
}

function totals(user: User, asOf: string): NormalizedAccountMetric[] {
  const stats = user.public_metrics ?? {};
  const metric = (metricKey: string, field: keyof typeof stats): NormalizedAccountMetric => {
    const value = stats[field];
    const common = {
      metricKey,
      sourceMetric: `public_metrics.${field}`,
      period: 'lifetime' as const,
      metricDate: asOf,
    };
    return value === undefined
      ? { ...common, value: null, availability: 'not_public' }
      : { ...common, value, availability: 'available' };
  };
  return [
    metric('followers', 'followers_count'),
    metric('following', 'following_count'),
    metric('posts_total', 'tweet_count'),
  ];
}

/** Raw responses without post text, so content deleted on X doesn't linger in debug storage. */
function withoutText(body: unknown): unknown {
  if (!body || typeof body !== 'object' || !('data' in body) || !Array.isArray(body.data)) {
    return body;
  }
  return {
    ...body,
    data: body.data.map((item: unknown) =>
      item && typeof item === 'object' && 'text' in item ? { ...item, text: '[not kept]' } : item,
    ),
  };
}

export class XPublicCollector implements PublicProfileCollector {
  readonly platformKey = PLATFORM;
  readonly billedPerRead = true;
  private raw: RawPayload[] = [];
  private users = new Map<string, User>();
  /** Billable reads made by this collector: X counts users and posts separately. */
  usersRead = 0;
  postsRead = 0;

  constructor(private readonly options: HttpOptions = {}) {}

  /** What this collector's reads cost at list price, before X's same-day deduplication. */
  get estimatedCostUsd(): number {
    return this.usersRead * X_PRICE_USD.user + this.postsRead * X_PRICE_USD.post;
  }

  drainRawPayloads(): RawPayload[] {
    const raw = this.raw;
    this.raw = [];
    return raw;
  }

  private async get(path: string, params: Record<string, string>, ctx: PublicContext) {
    if (!ctx.credential) throw new PlatformError('No X API key is configured', 'no_api_key');
    const url = new URL(`${BASE}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetchWithRetry(
      url.toString(),
      { method: 'GET', headers: { Authorization: `Bearer ${ctx.credential}` } },
      this.options,
    );
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ValidationError(`X returned a non-JSON response for ${path.split('/')[0]}`);
    }
    if (!response.ok) throw toXError(response.status, body as Problem, response.headers);
    this.raw.push({
      endpoint: `GET ${path.replace(/\d{5,}/g, ':id')}`,
      payload: withoutText(body),
    });
    return body;
  }

  private async user(ctx: PublicContext, handle: string): Promise<User> {
    const username = normalizeXHandle(handle);
    if (!X_USERNAME.test(username)) throw new XProfileNotFoundError(username);
    const cached = this.users.get(username.toLowerCase());
    if (cached) return cached;
    const body = parse(
      userSchema,
      await this.get(`users/by/username/${username}`, { 'user.fields': USER_FIELDS }, ctx),
      'user',
    );
    if (!body.data) {
      // Suspended accounts come back as an error too; say so rather than "not found".
      const suspended = /suspended/i.test(body.errors?.[0]?.detail ?? '');
      throw new XProfileNotFoundError(
        username,
        suspended ? `X has suspended "@${username}", so it has no public data.` : undefined,
      );
    }
    this.usersRead += 1;
    if (body.data.protected) throw new XProtectedProfileError(body.data.username);
    this.users.set(username.toLowerCase(), body.data);
    return body.data;
  }

  private toPage(body: Tweets, username: string): PublicPostPage {
    const media = new Map((body.includes?.media ?? []).map((m) => [m.media_key, m.type]));
    const tweets = body.data ?? [];
    this.postsRead += tweets.length;
    return {
      posts: tweets.map((tweet) => toPost(tweet, username, media)),
      metrics: tweets.flatMap(xPostMetrics),
      nextCursor: body.meta?.next_token ?? null,
    };
  }

  /** One page of the profile's own posts (no replies, no reposts), newest first. */
  private async timeline(
    ctx: PublicContext,
    user: User,
    maxResults: number,
    bounds: { sinceId?: string | null; startTime?: string; cursor?: string | null },
  ): Promise<PublicPostPage> {
    const body = parse(
      tweetsSchema,
      await this.get(
        `users/${user.id}/tweets`,
        {
          max_results: String(Math.min(100, Math.max(X_MIN_PAGE, maxResults))),
          exclude: 'retweets,replies',
          ...TWEET_PARAMS,
          ...(bounds.sinceId ? { since_id: bounds.sinceId } : {}),
          ...(!bounds.sinceId && bounds.startTime ? { start_time: bounds.startTime } : {}),
          ...(bounds.cursor ? { pagination_token: bounds.cursor } : {}),
        },
        ctx,
      ),
      'posts',
    );
    return this.toPage(body, user.username);
  }

  /**
   * Re-reads stored posts by id. Ids X doesn't return (deleted, withheld, or now protected)
   * are reported as removed.
   */
  private async recheck(ctx: PublicContext, user: User, ids: string[]) {
    if (!ids.length) return { page: emptyPage(), removed: [] as string[] };
    const body = parse(
      tweetsSchema,
      await this.get('tweets', { ids: ids.join(','), ...TWEET_PARAMS }, ctx),
      'post lookup',
    );
    const page = this.toPage(body, user.username);
    const found = new Set(page.posts.map((post) => post.externalId));
    return { page, removed: ids.filter((id) => !found.has(id)) };
  }

  async lookupProfile(ctx: PublicContext, handle: string) {
    const user = await this.user(ctx, handle);
    return {
      profile: toProfile(user),
      accountMetrics: totals(user, new Date().toISOString().slice(0, 10)),
    };
  }

  async observeProfile(
    ctx: PublicContext,
    handle: string,
    asOf: string,
    plan?: PublicReadPlan,
  ): Promise<PublicObservation> {
    const user = await this.user(ctx, handle);
    const sinceId = plan?.sinceId ?? null;
    const startTime =
      plan?.startTime ?? new Date(Date.now() - X_FIRST_READ_DAYS * 86_400_000).toISOString();
    // Re-reads first (a missed 7-day value can't be read later), leaving room for new posts.
    const recheckIds = [...new Set(plan?.recheckIds ?? [])].slice(
      0,
      X_MAX_POSTS_PER_RUN - X_MIN_PAGE,
    );
    const budget = X_MAX_POSTS_PER_RUN - recheckIds.length;

    const fresh: PublicPostPage = emptyPage();
    let cursor: string | null = null;
    let requests = 0;
    do {
      requests += 1;
      const page = await this.timeline(ctx, user, budget - fresh.posts.length, {
        sinceId,
        startTime,
        cursor,
      });
      fresh.posts.push(...page.posts);
      fresh.metrics.push(...page.metrics);
      cursor = page.nextCursor;
    } while (cursor && budget - fresh.posts.length >= X_MIN_PAGE && requests < X_MAX_REQUESTS);
    const truncated = cursor !== null;

    const { page: reread, removed } = await this.recheck(ctx, user, recheckIds);
    const oldestRead = fresh.posts.at(-1)?.publishedAt;
    const completeFrom = truncated && oldestRead ? oldestRead : sinceId ? undefined : startTime;
    return {
      profile: toProfile(user),
      accountMetrics: totals(user, asOf),
      firstPage: {
        posts: [...fresh.posts, ...reread.posts],
        metrics: [...fresh.metrics, ...reread.metrics],
        nextCursor: null,
      },
      removedPostIds: removed,
      ...(completeFrom ? { completeFrom } : {}),
    };
  }

  /** Older posts by page token. Billed; X profiles get no refresh or backfill job. */
  async listPosts(ctx: PublicContext, handle: string, cursor: string | null) {
    const user = await this.user(ctx, handle);
    return this.timeline(ctx, user, X_MAX_POSTS_PER_RUN, { cursor });
  }
}

function emptyPage(): PublicPostPage {
  return { posts: [], metrics: [], nextCursor: null };
}
