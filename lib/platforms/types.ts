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
export interface PlatformAdapter {
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
