import type { Enums } from '@/lib/db/types';

export type DataSource = Enums<'data_source'>;
export type BusinessRole = Enums<'business_role'>;
export type AccessType = Enums<'profile_access_type'>;
export type MediaFormat = Enums<'media_format'>;
export type MetricAvailability = Enums<'metric_availability'>;

/**
 * Why a number can't be shown. Every analytics result is either a value or one of these
 * reasons; a missing value is never turned into zero.
 */
export type UnavailableReason =
  | 'no_observations'
  | 'not_enough_observations'
  | 'no_baseline'
  | 'history_start_unknown'
  | 'history_starts_after_range'
  | 'window_too_short'
  | 'no_posts_at_age'
  | 'too_few_posts';

export type Unavailable = {
  status: 'unavailable';
  reason: UnavailableReason;
  /** Plain-language explanation, safe to show as-is. */
  detail: string;
};

export type Ok<T> = { status: 'ok' } & T;
export type Result<T> = Ok<T> | Unavailable;

export function unavailable(reason: UnavailableReason, detail: string): Unavailable {
  return { status: 'unavailable', reason, detail };
}

/** Short labels for tables and tiles. */
export const UNAVAILABLE_LABELS: Record<UnavailableReason, string> = {
  no_observations: 'not observed in this period',
  not_enough_observations: 'not enough observations yet',
  no_baseline: 'no starting value',
  history_start_unknown: 'post history not loaded yet',
  history_starts_after_range: 'post history starts later',
  window_too_short: 'less than a week of post history',
  no_posts_at_age: 'no likes + comments at 7 days yet',
  too_few_posts: 'too few posts to compare',
};

/** A half-open time window [start, end). */
export type Period = { start: Date; end: Date };

export type FollowerObservation = {
  /** When the value was observed (ISO timestamp). */
  at: string;
  value: number | null;
  availability: MetricAvailability;
  dataSource: DataSource;
};

/** One post with its public metrics at a fixed age (from post_metrics_at_age). */
export type PostRecord = {
  id: string;
  accountId: string;
  publishedAt: string;
  mediaFormat: MediaFormat;
  permalink: string | null;
  caption: string | null;
  hashtags: string[];
  dataSource: DataSource;
  /** Missing when no snapshot exists at the fixed age. */
  likes?: { value: number | null; availability: MetricAvailability; dataSource: DataSource };
  comments?: { value: number | null; availability: MetricAvailability; dataSource: DataSource };
};

export type ProfileRecord = {
  id: string;
  name: string;
  handle: string | null;
  platformKey: string;
  businessRole: BusinessRole;
  accessType: AccessType;
  countryCode: string | null;
  isActive: boolean;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  earliestPostAt: string | null;
};

export type ProfileSnapshotRecord = {
  accountId: string;
  observedAt: string;
  biography: string | null;
  website: string | null;
  dataSource: DataSource;
};
