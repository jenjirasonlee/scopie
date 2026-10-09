import { createClient } from '@/lib/db/server';
import type { Enums, Tables } from '@/lib/db/types';

export type SyncRun = Pick<
  Tables<'sync_runs'>,
  | 'id'
  | 'social_account_id'
  | 'job_type'
  | 'trigger'
  | 'status'
  | 'queued_at'
  | 'completed_at'
  | 'records_processed'
  | 'records_failed'
  | 'error_code'
  | 'error_message'
>;

const RUN_COLUMNS =
  'id, social_account_id, job_type, trigger, status, queued_at, completed_at, records_processed, records_failed, error_code, error_message';

export type PostWithMetrics = {
  id: string;
  externalId: string;
  publishedAt: string;
  permalink: string | null;
  caption: string | null;
  mediaFormat: Enums<'media_format'>;
  dataSource: Enums<'data_source'>;
  metrics: {
    key: string;
    value: number | null;
    availability: Enums<'metric_availability'> | null;
    capturedAt: string | null;
    /** Each source keeps its own value: public and connected numbers are never mixed. */
    source: Enums<'data_source'> | null;
  }[];
};

/** Sync status, recent runs, and the history range for one account. */
export async function getAccountPipeline(orgId: string, accountId: string) {
  const supabase = await createClient();
  const [state, runs, history] = await Promise.all([
    supabase
      .from('sync_state')
      .select(
        'job_type, last_success_at, last_attempt_at, next_run_after, consecutive_failures, completed',
      )
      .eq('organization_id', orgId)
      .eq('social_account_id', accountId),
    supabase
      .from('sync_runs')
      .select(RUN_COLUMNS)
      .eq('organization_id', orgId)
      .eq('social_account_id', accountId)
      .order('queued_at', { ascending: false })
      .limit(8),
    supabase
      .from('posts')
      .select('published_at')
      .eq('organization_id', orgId)
      .eq('social_account_id', accountId)
      .order('published_at', { ascending: true })
      .limit(1),
  ]);
  if (state.error) throw state.error;
  if (runs.error) throw runs.error;
  if (history.error) throw history.error;
  return {
    state: state.data,
    runs: runs.data as SyncRun[],
    earliestPostAt: history.data[0]?.published_at ?? null,
  };
}

/** The latest posts for an account with their most recent value for each metric. */
export async function listRecentPosts(
  orgId: string,
  accountId: string,
  limit = 10,
): Promise<PostWithMetrics[]> {
  const supabase = await createClient();
  const { data: posts, error } = await supabase
    .from('posts')
    .select('id, external_id, published_at, permalink, caption, media_format, data_source')
    .eq('organization_id', orgId)
    .eq('social_account_id', accountId)
    .is('removed_at', null)
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  if (!posts.length) return [];
  const { data: metrics, error: metricsError } = await supabase
    .from('post_metrics_latest')
    .select('post_id, metric_key, value, availability, captured_at, data_source')
    .in(
      'post_id',
      posts.map((post) => post.id),
    );
  if (metricsError) throw metricsError;
  return posts.map((post) => ({
    id: post.id,
    externalId: post.external_id,
    publishedAt: post.published_at,
    permalink: post.permalink,
    caption: post.caption,
    mediaFormat: post.media_format,
    dataSource: post.data_source,
    metrics: metrics
      .filter((metric) => metric.post_id === post.id && metric.metric_key)
      .map((metric) => ({
        key: metric.metric_key!,
        value: metric.value,
        availability: metric.availability,
        capturedAt: metric.captured_at,
        source: metric.data_source,
      })),
  }));
}

/** Recent sync runs across the organization, newest first, for the sync health view. */
export async function listRecentRuns(orgId: string, limit = 30) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sync_runs')
    .select(`${RUN_COLUMNS}, social_accounts(display_name, platform_key)`)
    .eq('organization_id', orgId)
    .order('queued_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function listImportBatches(orgId: string, limit = 20) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('import_batches')
    .select(
      'id, kind, file_name, status, rows_total, rows_imported, rows_skipped, errors, created_at, social_accounts(display_name, platform_key)',
    )
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export type ObservationHistory = {
  followers: {
    observedAt: string;
    day: string;
    value: number | null;
    source: Enums<'data_source'>;
  }[];
  profileChanges: {
    observedAt: string;
    username: string | null;
    displayName: string | null;
    biography: string | null;
    website: string | null;
  }[];
};

/**
 * Follower observations and profile changes for one profile, oldest first. Only what was
 * observed: no filled-in days. Public and connected observations are kept apart by source.
 */
export async function getObservationHistory(
  orgId: string,
  accountId: string,
  limit = 400,
): Promise<ObservationHistory> {
  const supabase = await createClient();
  const [followers, profiles] = await Promise.all([
    supabase
      .from('account_metric_snapshots')
      .select('captured_at, metric_date, value, data_source')
      .eq('organization_id', orgId)
      .eq('social_account_id', accountId)
      .eq('metric_key', 'followers')
      .eq('period', 'lifetime')
      .order('captured_at', { ascending: false })
      .limit(limit),
    supabase
      .from('profile_snapshots')
      .select('observed_at, username, display_name, biography, website')
      .eq('organization_id', orgId)
      .eq('social_account_id', accountId)
      .order('observed_at', { ascending: false })
      .limit(20),
  ]);
  if (followers.error) throw followers.error;
  if (profiles.error) throw profiles.error;
  return {
    followers: followers.data
      .map((row) => ({
        observedAt: row.captured_at,
        day: row.metric_date,
        value: row.value,
        source: row.data_source,
      }))
      .reverse(),
    profileChanges: profiles.data.map((row) => ({
      observedAt: row.observed_at,
      username: row.username,
      displayName: row.display_name,
      biography: row.biography,
      website: row.website,
    })),
  };
}
