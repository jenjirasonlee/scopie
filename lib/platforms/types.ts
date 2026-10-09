import type { Enums } from '@/lib/db/types';

export type MediaFormat = Enums<'media_format'>;
export type MetricAvailability = Enums<'metric_availability'>;
export type MetricPeriod = Enums<'metric_period'>;

/** A post as Scopie understands it, whatever platform it came from. */
export type NormalizedPost = {
  externalId: string;
  publishedAt: string; // ISO 8601
  permalink: string | null;
  caption: string | null;
  mediaFormat: MediaFormat;
  nativeType: string | null;
  isSharedPost?: boolean;
  media?: NormalizedMedia[];
};

export type NormalizedMedia = {
  position: number;
  mediaType: string;
  externalId: string | null;
  durationSeconds: number | null;
};

/**
 * One metric value. `value` is null unless availability is 'available'; a missing
 * metric is never reported as zero.
 */
export type NormalizedPostMetric = {
  postExternalId: string;
  metricKey: string;
  sourceMetric: string;
  value: number | null;
  availability: MetricAvailability;
  period: MetricPeriod;
  metricDate: string | null; // YYYY-MM-DD, only for period 'day'
};

export type NormalizedAccountMetric = {
  metricKey: string;
  sourceMetric: string;
  value: number | null;
  availability: MetricAvailability;
  /** 'day' = the value for metricDate; 'lifetime' = a running total (e.g. followers) as of metricDate. */
  period: MetricPeriod;
  metricDate: string;
};

/** What a connector needs to read one account. Built by the sync engine from encrypted credentials. */
export type AccountContext = {
  platformKey: string;
  externalId: string;
  accessToken: string;
  accountType: string | null;
};

export type PostPage = {
  posts: NormalizedPost[];
  nextCursor: string | null;
};

export type PostMetricsResult = {
  metrics: NormalizedPostMetric[];
  failures: { postExternalId: string; message: string }[];
};

export type AccountMetricRange = { since: string; until: string; asOf: string };

export type RawPayload = { endpoint: string; payload: unknown };

/**
 * A platform adapter turns one platform's API into Scopie's normalized records.
 * Adapters never touch the database, so each can be tested against saved responses.
 * Platform names and API field names stop here (docs/DATA_PIPELINE.md §2).
 */
export interface PrivateDataAdapter {
  readonly platformKey: string;
  /**
   * Daily account metrics for each complete day in [since, until], plus running totals
   * (e.g. followers) dated `asOf`, the day they were read.
   */
  getAccountMetrics(
    ctx: AccountContext,
    range: AccountMetricRange,
  ): Promise<NormalizedAccountMetric[]>;
  /** Newest posts first. Pass the previous page's cursor to continue. */
  listPosts(ctx: AccountContext, cursor: string | null): Promise<PostPage>;
  getPostMetrics(
    ctx: AccountContext,
    posts: Pick<NormalizedPost, 'externalId' | 'mediaFormat' | 'nativeType'>[],
  ): Promise<PostMetricsResult>;
  /** Raw responses collected since the last call, for 30-day debugging retention. */
  drainRawPayloads?(): RawPayload[];
}

// ---------------------------------------------------------------------------
// Public data: profiles read without the owner's authorization (PHASE_3_PLAN.md §6)
// ---------------------------------------------------------------------------

/** What a public collector needs: an app-level credential, never a profile owner's token. */
export type PublicContext = {
  /** Instagram: the viewer account's id. YouTube: unused. */
  viewerId: string | null;
  /** The viewer's connection, so an auth failure can mark it for reconnecting. */
  connectionId?: string | null;
  /** Instagram: the token of the Page the viewer account is linked to. YouTube: an API key. Server only. */
  credential: string;
};

export type PublicProfile = {
  externalId: string;
  username: string;
  displayName: string | null;
  biography: string | null;
  website: string | null;
  profilePictureUrl: string | null;
};

/** A post with the public metrics read in the same call, as of `observedAt`. */
export type PublicPostPage = {
  posts: NormalizedPost[];
  metrics: NormalizedPostMetric[];
  nextCursor: string | null;
};

export type PublicObservation = {
  profile: PublicProfile;
  /** Running totals such as followers and post count, dated the day they were read. */
  accountMetrics: NormalizedAccountMetric[];
  firstPage: PublicPostPage;
};

/**
 * Reads public profiles through a platform's official public API. Collectors never touch
 * the database, never scrape, and report a metric the API doesn't give as unavailable.
 */
export interface PublicProfileCollector {
  readonly platformKey: string;
  /** Profile fields and totals, for the "add profile" preview. */
  lookupProfile(
    ctx: PublicContext,
    handle: string,
  ): Promise<{ profile: PublicProfile; accountMetrics: NormalizedAccountMetric[] }>;
  /** Profile, totals and the newest page of posts with their metrics. */
  observeProfile(ctx: PublicContext, handle: string, asOf: string): Promise<PublicObservation>;
  /** Older posts, newest first, with their metrics as of now. */
  listPosts(ctx: PublicContext, handle: string, cursor: string | null): Promise<PublicPostPage>;
  /** Share of the platform's rate limit used so far (0-100), when the platform reports it. */
  readonly appUsage?: number;
  drainRawPayloads?(): RawPayload[];
}
