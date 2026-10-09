import { z } from 'zod';
import { PermissionError, PlatformError, RateLimitError, ValidationError } from '../errors';
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
  ProfileSearchResult,
  PublicProfileCollector,
  RawPayload,
} from '../types';

/**
 * Public Bluesky profiles through the AT Protocol's public AppView. No key and no login:
 * every public profile and post can be read. Only fields the lexicons define are used; a
 * count the AppView leaves out is reported as unavailable, never as 0.
 * https://docs.bsky.app/docs/api/app-bsky-actor-get-profile
 * https://docs.bsky.app/docs/api/app-bsky-feed-get-author-feed
 * https://docs.bsky.app/docs/api/app-bsky-actor-search-actors-typeahead
 *
 * Accounts that ask apps not to show them to logged-out users (the `!no-unauthenticated`
 * label) are not read.
 */

const PLATFORM = 'bluesky';
const BASE = 'https://public.api.bsky.app/xrpc';
export const BLUESKY_PAGE_SIZE = 100;

/** A domain handle, e.g. name.bsky.social or brand.com (atproto handle syntax). */
export const BLUESKY_HANDLE =
  /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;
/** A decentralized identifier: did:plc:… or did:web:…. */
export const BLUESKY_DID = /^did:(plc:[a-z2-7]{24}|web:[a-z0-9.-]{3,253})$/;

/**
 * Accepts @name.bsky.social, name.bsky.social, a custom-domain handle, a DID, or a
 * https://bsky.app/profile/<handle> link. A bare name ("@brand") means brand.bsky.social.
 */
export function normalizeBlueskyHandle(raw: string): string {
  const value = raw
    .trim()
    .replace(/^https?:\/\/(www\.)?bsky\.app\/profile\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '')
    .toLowerCase();
  if (/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) return `${value}.bsky.social`;
  return value;
}

export function isBlueskyHandle(value: string): boolean {
  return BLUESKY_HANDLE.test(value) || BLUESKY_DID.test(value);
}

const NO_LOGGED_OUT = '!no-unauthenticated';

const labelsSchema = z.array(z.object({ val: z.string() })).optional();

const profileSchema = z.object({
  did: z.string(),
  handle: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  avatar: z.string().optional(),
  followersCount: z.number().optional(),
  followsCount: z.number().optional(),
  postsCount: z.number().optional(),
  labels: labelsSchema,
});

const profilesSchema = z.object({ profiles: z.array(profileSchema) });
const typeaheadSchema = z.object({
  actors: z.array(z.object({ did: z.string(), labels: labelsSchema })),
});

const embedSchema = z
  .object({
    $type: z.string(),
    media: z.object({ $type: z.string() }).optional(),
  })
  .optional();

const feedSchema = z.object({
  cursor: z.string().optional(),
  feed: z.array(
    z.object({
      post: z.object({
        uri: z.string(),
        author: z.object({ did: z.string(), handle: z.string() }),
        record: z.object({ text: z.string().optional(), createdAt: z.string().optional() }),
        embed: embedSchema,
        replyCount: z.number().optional(),
        repostCount: z.number().optional(),
        likeCount: z.number().optional(),
        quoteCount: z.number().optional(),
        indexedAt: z.string(),
      }),
      // Present on reposts of others (and pinned posts when asked for): not the profile's own post.
      reason: z.object({ $type: z.string() }).optional(),
    }),
  ),
});

type Profile = z.infer<typeof profileSchema>;
type FeedPost = z.infer<typeof feedSchema>['feed'][number]['post'];

/** The handle is not a Bluesky account the AppView returns. Not retried. */
export class BlueskyProfileNotFoundError extends PlatformError {
  constructor(handle: string) {
    super(`Bluesky has no public account "@${handle}".`, 'profile_not_found');
    this.name = 'BlueskyProfileNotFoundError';
  }
}

/** The account asked apps not to show it to logged-out users. Not read. */
export class BlueskyHiddenProfileError extends PlatformError {
  constructor(handle: string) {
    super(
      `@${handle} asks apps not to show the account to people who aren't logged in, so Scopie doesn't read it.`,
      'profile_protected',
    );
    this.name = 'BlueskyHiddenProfileError';
  }
}

function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(
      `Unexpected Bluesky ${what} response: ${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim(),
    );
  }
  return result.data;
}

type XrpcError = { error?: string; message?: string };

/** Seconds to wait from Retry-After or ratelimit-reset (a Unix time), at least a minute. */
function retryAfter(headers: Headers): number {
  const after = Number(headers.get('retry-after'));
  if (Number.isFinite(after) && after > 0) return Math.max(60, Math.ceil(after));
  const reset = Number(headers.get('ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) {
    return Math.max(60, Math.ceil(reset - Date.now() / 1000));
  }
  return 300;
}

export function toBlueskyError(
  status: number,
  body: XrpcError,
  headers: Headers,
  handle: string,
): PlatformError {
  const message = redactText(body.message ?? body.error ?? `Bluesky error (HTTP ${status})`);
  if (status === 429) return new RateLimitError(retryAfter(headers), 'Bluesky rate limit reached');
  if (
    ['AccountTakedown', 'AccountDeactivated', 'NotFound', 'ProfileNotFound'].includes(
      body.error ?? '',
    ) ||
    (status === 400 && /not found|could not find|unable to resolve/i.test(message))
  ) {
    return new BlueskyProfileNotFoundError(handle);
  }
  if (status === 401 || status === 403) return new PermissionError(`Bluesky refused: ${message}`);
  return new PlatformError(message, 'platform_error', status);
}

/** images → image; video → video; link card → link; text or quote only → text. */
export function blueskyMediaFormat(post: FeedPost): MediaFormat {
  const types = [post.embed?.$type, post.embed?.media?.$type];
  if (types.some((type) => type?.startsWith('app.bsky.embed.video'))) return 'video';
  if (types.some((type) => type?.startsWith('app.bsky.embed.images'))) return 'image';
  if (types.some((type) => type?.startsWith('app.bsky.embed.external'))) return 'link';
  return 'text';
}

function rkey(uri: string): string {
  return uri.split('/').at(-1) ?? uri;
}

function publishedAt(post: FeedPost): string {
  const created = Date.parse(post.record.createdAt ?? '');
  return new Date(Number.isFinite(created) ? created : Date.parse(post.indexedAt)).toISOString();
}

function toPost(post: FeedPost): NormalizedPost {
  const author = post.author.handle === 'handle.invalid' ? post.author.did : post.author.handle;
  return {
    externalId: post.uri,
    publishedAt: publishedAt(post),
    permalink: `https://bsky.app/profile/${author}/post/${rkey(post.uri)}`,
    caption: post.record.text || null,
    mediaFormat: blueskyMediaFormat(post),
    nativeType: post.embed?.$type.replace(/#view$/, '') ?? 'app.bsky.feed.post',
  };
}

/** Likes, replies, reposts and quotes as returned; a missing count is unavailable, not 0. */
export function blueskyPostMetrics(post: FeedPost): NormalizedPostMetric[] {
  const base = { postExternalId: post.uri, period: 'lifetime' as const, metricDate: null };
  const metric = (
    metricKey: string,
    field: 'likeCount' | 'replyCount' | 'repostCount' | 'quoteCount',
  ): NormalizedPostMetric => {
    const value = post[field];
    return value === undefined
      ? { ...base, metricKey, sourceMetric: field, value: null, availability: 'not_public' }
      : { ...base, metricKey, sourceMetric: field, value, availability: 'available' };
  };
  return [
    metric('likes', 'likeCount'),
    metric('comments', 'replyCount'),
    metric('shares', 'repostCount'),
    metric('quotes', 'quoteCount'),
  ];
}

function toProfile(profile: Profile): PublicProfile {
  return {
    externalId: profile.did,
    username: profile.handle === 'handle.invalid' ? profile.did : profile.handle,
    displayName: profile.displayName || null,
    biography: profile.description || null,
    website: null,
    profilePictureUrl: profile.avatar ?? null,
  };
}

function totals(profile: Profile, asOf: string): NormalizedAccountMetric[] {
  const metric = (
    metricKey: string,
    field: 'followersCount' | 'followsCount' | 'postsCount',
  ): NormalizedAccountMetric => {
    const value = profile[field];
    const common = {
      metricKey,
      sourceMetric: field,
      period: 'lifetime' as const,
      metricDate: asOf,
    };
    return value === undefined
      ? { ...common, value: null, availability: 'not_public' }
      : { ...common, value, availability: 'available' };
  };
  return [
    metric('followers', 'followersCount'),
    metric('following', 'followsCount'),
    metric('posts_total', 'postsCount'),
  ];
}

export class BlueskyPublicCollector implements PublicProfileCollector {
  readonly platformKey = PLATFORM;
  private raw: RawPayload[] = [];
  private dids = new Map<string, string>();

  constructor(private readonly options: HttpOptions = {}) {}

  drainRawPayloads(): RawPayload[] {
    const raw = this.raw;
    this.raw = [];
    return raw;
  }

  private async get(method: string, params: Record<string, string>, handle: string) {
    return this.getQuery(method, new URLSearchParams(params), handle);
  }

  private async getQuery(method: string, params: URLSearchParams, handle: string) {
    const url = new URL(`${BASE}/${method}`);
    url.search = params.toString();
    const response = await fetchWithRetry(
      url.toString(),
      { method: 'GET', headers: { Accept: 'application/json' } },
      this.options,
    );
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ValidationError(`Bluesky returned a non-JSON response for ${method}`);
    }
    if (!response.ok) {
      throw toBlueskyError(response.status, body as XrpcError, response.headers, handle);
    }
    this.raw.push({ endpoint: `GET ${method}`, payload: body });
    return body;
  }

  private async profile(handle: string): Promise<Profile> {
    const actor = normalizeBlueskyHandle(handle);
    if (!isBlueskyHandle(actor)) throw new BlueskyProfileNotFoundError(actor);
    const profile = parse(
      profileSchema,
      await this.get('app.bsky.actor.getProfile', { actor }, actor),
      'profile',
    );
    if (profile.labels?.some((label) => label.val === NO_LOGGED_OUT)) {
      throw new BlueskyHiddenProfileError(profile.handle);
    }
    this.dids.set(actor, profile.did);
    return profile;
  }

  private async page(did: string, handle: string, cursor: string | null): Promise<PublicPostPage> {
    const body = parse(
      feedSchema,
      await this.get(
        'app.bsky.feed.getAuthorFeed',
        {
          actor: did,
          filter: 'posts_no_replies',
          limit: String(BLUESKY_PAGE_SIZE),
          ...(cursor ? { cursor } : {}),
        },
        handle,
      ),
      'feed',
    );
    const own = body.feed
      .filter((item) => !item.reason && item.post.author.did === did)
      .map((item) => item.post);
    return {
      posts: own.map(toPost),
      metrics: own.flatMap(blueskyPostMetrics),
      // An empty page with a cursor would loop; the feed has ended.
      nextCursor: body.feed.length ? (body.cursor ?? null) : null,
    };
  }

  /** Profiles matching a name or handle: typeahead search, then their public counts. */
  async searchProfiles(
    _ctx: PublicContext,
    query: string,
    limit: number,
  ): Promise<ProfileSearchResult[]> {
    const found = parse(
      typeaheadSchema,
      await this.get(
        'app.bsky.actor.searchActorsTypeahead',
        { q: query, limit: String(limit) },
        query,
      ),
      'search',
    );
    const visible = (labels: { val: string }[] | undefined) =>
      !labels?.some((label) => label.val === NO_LOGGED_OUT);
    const dids = found.actors.filter((actor) => visible(actor.labels)).map((actor) => actor.did);
    if (!dids.length) return [];
    const url = new URLSearchParams();
    for (const did of dids) url.append('actors', did);
    const body = parse(
      profilesSchema,
      await this.getQuery('app.bsky.actor.getProfiles', url, query),
      'profiles',
    );
    return body.profiles
      .filter((profile) => visible(profile.labels))
      .map((profile) => {
        const mapped = toProfile(profile);
        return {
          externalId: mapped.externalId,
          username: mapped.username,
          displayName: mapped.displayName,
          profilePictureUrl: mapped.profilePictureUrl,
          followers: profile.followersCount ?? null,
        };
      });
  }

  async lookupProfile(_ctx: PublicContext, handle: string) {
    const profile = await this.profile(handle);
    return {
      profile: toProfile(profile),
      accountMetrics: totals(profile, new Date().toISOString().slice(0, 10)),
    };
  }

  async observeProfile(
    _ctx: PublicContext,
    handle: string,
    asOf: string,
  ): Promise<PublicObservation> {
    const profile = await this.profile(handle);
    return {
      profile: toProfile(profile),
      accountMetrics: totals(profile, asOf),
      firstPage: await this.page(profile.did, profile.handle, null),
    };
  }

  async listPosts(_ctx: PublicContext, handle: string, cursor: string | null) {
    const actor = normalizeBlueskyHandle(handle);
    const did = this.dids.get(actor) ?? (await this.profile(handle)).did;
    return this.page(did, actor, cursor);
  }
}
