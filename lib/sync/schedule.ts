import type { Enums } from '@/lib/db/types';

export type SyncJobType = Enums<'sync_job_type'>;

/** Post ages (in days) at which Scopie captures a snapshot. After the last one, metrics stop. */
export const CAPTURE_AGES_DAYS = [1, 2, 3, 7, 14, 30, 90] as const;
export const LAST_CAPTURE_HOURS = CAPTURE_AGES_DAYS.at(-1)! * 24;

/** Jobs that read a connected profile with its owner's authorization. */
export const CONNECTED_JOBS = [
  'account_daily',
  'posts_incremental',
  'post_metrics_refresh',
  'backfill',
] as const satisfies readonly SyncJobType[];

/** Jobs that read a profile's public data through the organization's viewer account. */
export const PUBLIC_JOBS = [
  'public_profile_daily',
  'public_posts_refresh',
  'public_backfill',
] as const satisfies readonly SyncJobType[];

export function isPublicJob(job: SyncJobType): job is (typeof PUBLIC_JOBS)[number] {
  return (PUBLIC_JOBS as readonly string[]).includes(job);
}

/** How often each job runs for every account it applies to. */
export const JOB_INTERVAL_MINUTES: Record<SyncJobType, number> = {
  account_daily: 24 * 60,
  posts_incremental: 6 * 60,
  post_metrics_refresh: 60,
  backfill: 60,
  // One observation a day is the follower history; posts are re-read as they age.
  public_profile_daily: 24 * 60,
  public_posts_refresh: 3 * 60,
  public_backfill: 60,
};

/** Re-check posts published up to this long before the newest one already stored. */
export const INCREMENTAL_OVERLAP_DAYS = 3;
/** How many days of account metrics the first daily sync asks for. */
export const FIRST_ACCOUNT_SYNC_DAYS = 28;
/** Days re-read on every daily sync, because platforms revise recent days. */
export const ACCOUNT_RESYNC_DAYS = 3;

export const MAX_PAGES: Record<SyncJobType, number> = {
  account_daily: 1,
  posts_incremental: 10,
  post_metrics_refresh: 1,
  backfill: 5,
  public_profile_daily: 1,
  public_posts_refresh: 4,
  public_backfill: 20,
};

/** Public backfill reads posts back this far, then stops (PHASE_3_PLAN.md §7). */
export const PUBLIC_BACKFILL_MONTHS = 12;

/**
 * Meta's X-App-Usage percentage above which public jobs stop for the hour, leaving room for
 * connected syncs and the add-profile lookup.
 */
export const PUBLIC_USAGE_PAUSE_PERCENT = 80;

export const METRICS_BATCH_SIZE = 25;
export const MAX_POSTS_PER_REFRESH = 200;

/**
 * True when a post is due for a snapshot: it has passed a capture age that the
 * newest stored snapshot hasn't reached yet.
 */
export function isSnapshotDue(ageHours: number, lastCapturedAgeHours: number | null): boolean {
  if (ageHours < 0) return false;
  if (lastCapturedAgeHours === null) return true;
  return CAPTURE_AGES_DAYS.some((days) => {
    const target = days * 24;
    return ageHours >= target && lastCapturedAgeHours < target;
  });
}

/** Wait after consecutive failures: 15 min, 30, 60, ... capped at 24 hours. */
export function backoffMinutes(consecutiveFailures: number): number {
  return Math.min(15 * 2 ** Math.max(0, consecutiveFailures - 1), 24 * 60);
}

/** Failures in a row before an account is shown as "Sync error". */
export const FAILURES_BEFORE_ERROR_STATUS = 3;

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shiftDay(day: string, days: number): string {
  return isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000));
}
