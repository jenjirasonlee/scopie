import { z } from 'zod';
import { PlatformError } from '../errors';
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
import { GraphClient, type GraphClientOptions } from './graph';
import { instagramMediaFormat } from './instagram';
import { parseGraph } from './shared';

/**
 * Public Instagram data through Business Discovery: profile fields, totals and posts of
 * any Business or Creator account, requested through the organization's viewer account.
 * The profile owner authorizes nothing. Only fields Meta documents as public are used.
 * https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery
 */

const PLATFORM = 'instagram';
export const PAGE_SIZE = 25;

/** Instagram usernames: letters, digits, periods and underscores, at most 30. */
export const INSTAGRAM_USERNAME = /^[A-Za-z0-9._]{1,30}$/;

const PROFILE_FIELDS = ['id', 'username', 'biography', 'website', 'followers_count', 'media_count'];
/** Not marked public in Meta's reference; requested, and dropped if Meta refuses them. */
const OPTIONAL_PROFILE_FIELDS = ['name', 'profile_picture_url'];
const MEDIA_FIELDS = [
  'id',
  'caption',
  'media_type',
  'media_product_type',
  'permalink',
  'timestamp',
  'like_count',
  'comments_count',
  'view_count',
];

const mediaSchema = z.object({
  id: z.string(),
  caption: z.string().optional(),
  media_type: z.string(),
  media_product_type: z.string().optional(),
  permalink: z.string().optional(),
  timestamp: z.string(),
  like_count: z.number().optional(),
  comments_count: z.number().optional(),
  view_count: z.number().optional(),
});

const mediaEdgeSchema = z.object({
  data: z.array(mediaSchema),
  paging: z.object({ cursors: z.object({ after: z.string().optional() }).optional() }).optional(),
});

const discoverySchema = z.object({
  business_discovery: z.object({
    id: z.string(),
    username: z.string(),
    name: z.string().optional(),
    biography: z.string().optional(),
    website: z.string().optional(),
    profile_picture_url: z.string().optional(),
    followers_count: z.number().optional(),
    media_count: z.number().optional(),
    media: mediaEdgeSchema.optional(),
  }),
});

type Discovery = z.infer<typeof discoverySchema>['business_discovery'];
type Media = z.infer<typeof mediaSchema>;

/** The username was not found as a Business or Creator account. Not retried. */
export class ProfileNotFoundError extends PlatformError {
  constructor(handle: string) {
    super(
      `Instagram has no business or creator account "@${handle}" that Scopie can read. Personal and age-restricted accounts can't be read through the official API.`,
      'profile_not_found',
    );
    this.name = 'ProfileNotFoundError';
  }
}

export function normalizeHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '');
}

function toPost(media: Media): NormalizedPost {
  return {
    externalId: media.id,
    publishedAt: new Date(media.timestamp).toISOString(),
    permalink: media.permalink ?? null,
    caption: media.caption ?? null,
    mediaFormat: instagramMediaFormat(media.media_type, media.media_product_type),
    nativeType: media.media_product_type
      ? `${media.media_type}/${media.media_product_type}`
      : media.media_type,
  };
}

/** Likes, comments and Reel views as Meta returned them; a missing value is a reason, not 0. */
export function publicPostMetrics(media: Media): NormalizedPostMetric[] {
  const base = { postExternalId: media.id, period: 'lifetime' as const, metricDate: null };
  const isReel = media.media_product_type === 'REELS';
  return [
    {
      ...base,
      metricKey: 'likes',
      sourceMetric: 'business_discovery.like_count',
      ...(media.like_count === undefined
        ? { value: null, availability: 'hidden_by_owner' as const }
        : { value: media.like_count, availability: 'available' as const }),
    },
    {
      ...base,
      metricKey: 'comments',
      sourceMetric: 'business_discovery.comments_count',
      ...(media.comments_count === undefined
        ? { value: null, availability: 'not_permitted' as const }
        : { value: media.comments_count, availability: 'available' as const }),
    },
    {
      ...base,
      metricKey: 'views',
      sourceMetric: 'business_discovery.view_count',
      ...(!isReel
        ? { value: null, availability: 'not_applicable' as const }
        : media.view_count === undefined
          ? { value: null, availability: 'not_permitted' as const }
          : { value: media.view_count, availability: 'available' as const }),
    },
  ];
}

function toProfile(discovery: Discovery): PublicProfile {
  return {
    externalId: discovery.id,
    username: discovery.username,
    displayName: discovery.name ?? null,
    biography: discovery.biography ?? null,
    website: discovery.website ?? null,
    profilePictureUrl: discovery.profile_picture_url ?? null,
  };
}

function totals(discovery: Discovery, asOf: string): NormalizedAccountMetric[] {
  const metric = (metricKey: string, sourceMetric: string, value: number | undefined) =>
    ({
      metricKey,
      sourceMetric,
      period: 'lifetime',
      metricDate: asOf,
      ...(value === undefined
        ? { value: null, availability: 'not_permitted' }
        : { value, availability: 'available' }),
    }) as NormalizedAccountMetric;
  return [
    metric('followers', 'business_discovery.followers_count', discovery.followers_count),
    metric('posts_total', 'business_discovery.media_count', discovery.media_count),
  ];
}

function toPage(edge: z.infer<typeof mediaEdgeSchema> | undefined): PublicPostPage {
  const data = edge?.data ?? [];
  const after = edge?.paging?.cursors?.after;
  return {
    posts: data.map(toPost),
    metrics: data.flatMap(publicPostMetrics),
    // Business Discovery returns cursors but no "next" link; a short page is the last one.
    nextCursor: data.length >= PAGE_SIZE && after ? after : null,
  };
}

export class InstagramPublicCollector implements PublicProfileCollector {
  readonly platformKey = PLATFORM;
  private readonly graph: GraphClient;
  private raw: RawPayload[] = [];
  private optionalFieldsRefused = false;
  /** Highest X-App-Usage percentage seen by this collector. */
  appUsage = 0;

  constructor(options: GraphClientOptions = {}) {
    this.graph = new GraphClient({
      ...options,
      onUsage: (percent) => {
        this.appUsage = Math.max(this.appUsage, percent);
        options.onUsage?.(percent);
      },
      onResponse: (endpoint, body) => {
        this.raw.push({ endpoint, payload: body });
        options.onResponse?.(endpoint, body);
      },
    });
  }

  drainRawPayloads(): RawPayload[] {
    const raw = this.raw;
    this.raw = [];
    return raw;
  }

  private async discover(ctx: PublicContext, handle: string, mediaPart: string | null) {
    const username = normalizeHandle(handle);
    if (!INSTAGRAM_USERNAME.test(username)) throw new ProfileNotFoundError(username);
    if (!ctx.viewerId) {
      throw new PlatformError('No Instagram viewer account is set up', 'no_viewer');
    }
    const fields = (withOptional: boolean) =>
      [...PROFILE_FIELDS, ...(withOptional ? OPTIONAL_PROFILE_FIELDS : []), mediaPart]
        .filter(Boolean)
        .join(',');
    const call = (withOptional: boolean) =>
      this.graph.get<unknown>(
        ctx.viewerId!,
        { fields: `business_discovery.username(${username}){${fields(withOptional)}}` },
        ctx.credential,
      );
    let body: unknown;
    try {
      body = await call(!this.optionalFieldsRefused);
    } catch (error) {
      if (!(error instanceof PlatformError) || error.code !== 'invalid_parameter') throw error;
      if (this.optionalFieldsRefused) throw new ProfileNotFoundError(username);
      // Either an optional field was refused or the profile can't be read. Try once without.
      this.optionalFieldsRefused = true;
      try {
        body = await call(false);
      } catch (retryError) {
        if (retryError instanceof PlatformError && retryError.code === 'invalid_parameter') {
          throw new ProfileNotFoundError(username);
        }
        throw retryError;
      }
    }
    return parseGraph(discoverySchema, body, 'Business Discovery').business_discovery;
  }

  async lookupProfile(ctx: PublicContext, handle: string) {
    const discovery = await this.discover(ctx, handle, null);
    const today = new Date().toISOString().slice(0, 10);
    return { profile: toProfile(discovery), accountMetrics: totals(discovery, today) };
  }

  async observeProfile(
    ctx: PublicContext,
    handle: string,
    asOf: string,
  ): Promise<PublicObservation> {
    const discovery = await this.discover(
      ctx,
      handle,
      `media.limit(${PAGE_SIZE}){${MEDIA_FIELDS.join(',')}}`,
    );
    return {
      profile: toProfile(discovery),
      accountMetrics: totals(discovery, asOf),
      firstPage: toPage(discovery.media),
    };
  }

  async listPosts(ctx: PublicContext, handle: string, cursor: string | null) {
    const after = cursor ? `.after(${cursor})` : '';
    const discovery = await this.discover(
      ctx,
      handle,
      `media${after}.limit(${PAGE_SIZE}){${MEDIA_FIELDS.join(',')}}`,
    );
    return toPage(discovery.media);
  }
}
