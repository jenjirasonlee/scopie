import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database, Enums, TablesInsert } from '@/lib/db/types';
import { isStorableMetric } from '@/lib/metrics/registry';
import type {
  NormalizedAccountMetric,
  NormalizedPost,
  NormalizedPostMetric,
} from '@/lib/platforms/types';

export type Db = SupabaseClient<Database>;
type DataSource = Enums<'data_source'>;

/**
 * The single entry point for storing social data. Platform adapters, CSV import and
 * the demo generator all write through here, so the same rules apply to every
 * source: known metric keys only, value and availability agree, no negative or
 * infinite numbers, duplicates skipped. The database repeats the source rules
 * (who may write live, imported or demo data) as a second line of defence.
 */
export type IngestInput = {
  organizationId: string;
  socialAccountId: string;
  platformKey: string;
  dataSource: DataSource;
  /** When the values were read. Every row in one batch shares it, which makes retries idempotent. */
  capturedAt: string;
  syncRunId?: string | null;
  importBatchId?: string | null;
  posts?: NormalizedPost[];
  postMetrics?: NormalizedPostMetric[];
  accountMetrics?: NormalizedAccountMetric[];
};

export type Rejection = {
  kind: 'post' | 'post_metric' | 'account_metric';
  ref: string;
  reason: string;
};

export type IngestResult = {
  postsWritten: number;
  postMetricsWritten: number;
  accountMetricsWritten: number;
  duplicatesSkipped: number;
  rejected: Rejection[];
  /** external id → Scopie post id, for every post in or referenced by this batch */
  postIds: Map<string, string>;
};

/**
 * 'sync' runs with the service role and may refresh a post's caption and media.
 * 'user' runs as the signed-in user (imports): it only adds rows, never changes them.
 */
export type IngestMode = 'sync' | 'user';

const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });
const finiteNonNegative = z.number().finite().nonnegative();

const CHUNK = 500;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += CHUNK)
    out.push(items.slice(index, index + CHUNK));
  return out;
}

/** Shared value checks. Returns a reason when the metric must be rejected. */
export function checkMetricValue(
  metric: {
    metricKey: string;
    value: number | null;
    availability: string;
    period: string;
    metricDate: string | null;
  },
  scope: 'account' | 'post',
): string | null {
  if (!isStorableMetric(metric.metricKey, scope)) {
    return `"${metric.metricKey}" is not a stored ${scope} metric`;
  }
  if (metric.availability === 'available') {
    if (metric.value === null) return 'available metric without a value';
    if (!finiteNonNegative.safeParse(metric.value).success)
      return 'value must be a number of zero or more';
  } else if (metric.value !== null) {
    return `a value was given but availability is "${metric.availability}"`;
  }
  if (metric.period === 'day' || scope === 'account') {
    if (!metric.metricDate || !isoDate.safeParse(metric.metricDate).success)
      return 'missing or invalid date';
  }
  return null;
}

export async function ingest(db: Db, input: IngestInput, mode: IngestMode): Promise<IngestResult> {
  const result: IngestResult = {
    postsWritten: 0,
    postMetricsWritten: 0,
    accountMetricsWritten: 0,
    duplicatesSkipped: 0,
    rejected: [],
    postIds: new Map(),
  };
  if (!isoDateTime.safeParse(input.capturedAt).success)
    throw new Error('capturedAt must be an ISO timestamp');

  const common = {
    organization_id: input.organizationId,
    data_source: input.dataSource,
    import_batch_id: input.importBatchId ?? null,
  };

  // --- Posts ---------------------------------------------------------------
  const validPosts: NormalizedPost[] = [];
  const seen = new Set<string>();
  for (const post of input.posts ?? []) {
    if (!post.externalId) {
      result.rejected.push({ kind: 'post', ref: '(empty)', reason: 'missing post id' });
    } else if (!isoDateTime.safeParse(post.publishedAt).success) {
      result.rejected.push({ kind: 'post', ref: post.externalId, reason: 'invalid publish time' });
    } else if (Date.parse(post.publishedAt) > Date.parse(input.capturedAt)) {
      result.rejected.push({
        kind: 'post',
        ref: post.externalId,
        reason: 'published after it was captured',
      });
    } else if (seen.has(post.externalId)) {
      result.rejected.push({
        kind: 'post',
        ref: post.externalId,
        reason: 'listed twice in the same batch',
      });
    } else {
      seen.add(post.externalId);
      validPosts.push(post);
    }
  }

  for (const batch of chunks(validPosts)) {
    const rows: TablesInsert<'posts'>[] = batch.map((post) => ({
      ...common,
      social_account_id: input.socialAccountId,
      platform_key: input.platformKey,
      external_id: post.externalId,
      published_at: post.publishedAt,
      published_local_date: post.publishedAt.slice(0, 10), // replaced by the database trigger
      permalink: post.permalink,
      caption: post.caption,
      media_format: post.mediaFormat,
      native_type: post.nativeType,
      is_shared_post: post.isSharedPost ?? false,
      ...(mode === 'sync' ? { last_fetched_at: input.capturedAt } : {}),
    }));
    const { data, error } = await db
      .from('posts')
      .upsert(rows, {
        onConflict: 'social_account_id,external_id',
        ignoreDuplicates: mode === 'user',
      })
      .select('id, external_id');
    if (error) throw new Error(`Could not store posts: ${error.message}`);
    result.postsWritten += data.length;
    if (mode === 'user') result.duplicatesSkipped += batch.length - data.length;
    for (const row of data) result.postIds.set(row.external_id, row.id);
  }

  // Resolve ids for posts that already existed or are only referenced by metrics.
  const wanted = new Set<string>([
    ...validPosts.map((post) => post.externalId),
    ...(input.postMetrics ?? []).map((metric) => metric.postExternalId),
  ]);
  const missing = [...wanted].filter((externalId) => !result.postIds.has(externalId));
  for (const batch of chunks(missing)) {
    const { data, error } = await db
      .from('posts')
      .select('id, external_id')
      .eq('social_account_id', input.socialAccountId)
      .in('external_id', batch);
    if (error) throw new Error(`Could not look up posts: ${error.message}`);
    for (const row of data) result.postIds.set(row.external_id, row.id);
  }

  if (mode === 'sync') {
    const media = validPosts.flatMap((post) =>
      (post.media ?? []).map((item) => ({
        organization_id: input.organizationId,
        post_id: result.postIds.get(post.externalId)!,
        position: item.position,
        media_type: item.mediaType,
        external_id: item.externalId,
        duration_seconds: item.durationSeconds,
      })),
    );
    for (const batch of chunks(media.filter((row) => row.post_id))) {
      const { error } = await db
        .from('post_media')
        .upsert(batch, { onConflict: 'post_id,position' });
      if (error) throw new Error(`Could not store post media: ${error.message}`);
    }
  }

  // --- Post metrics ----------------------------------------------------------
  const postMetricRows: TablesInsert<'post_metric_snapshots'>[] = [];
  for (const metric of input.postMetrics ?? []) {
    const ref = `${metric.postExternalId}/${metric.metricKey}`;
    const postId = result.postIds.get(metric.postExternalId);
    const reason = postId ? checkMetricValue(metric, 'post') : 'unknown post';
    if (reason) {
      result.rejected.push({ kind: 'post_metric', ref, reason });
      continue;
    }
    postMetricRows.push({
      ...common,
      post_id: postId!,
      metric_key: metric.metricKey,
      source_metric: metric.sourceMetric,
      value: metric.value,
      availability: metric.availability,
      period: metric.period,
      metric_date: metric.period === 'day' ? metric.metricDate : null,
      captured_at: input.capturedAt,
      post_age_hours: 0, // replaced by the database trigger
      sync_run_id: input.syncRunId ?? null,
    });
  }
  for (const batch of chunks(postMetricRows)) {
    const { data, error } = await db
      .from('post_metric_snapshots')
      .upsert(batch, {
        onConflict: 'post_id,metric_key,period,metric_date,captured_at',
        ignoreDuplicates: true,
      })
      .select('id');
    if (error) throw new Error(`Could not store post metrics: ${error.message}`);
    result.postMetricsWritten += data.length;
    result.duplicatesSkipped += batch.length - data.length;
  }

  if (mode === 'sync' && postMetricRows.length) {
    const touched = [...new Set(postMetricRows.map((row) => row.post_id))];
    for (const batch of chunks(touched)) {
      const { error } = await db
        .from('posts')
        .update({ last_metrics_at: input.capturedAt })
        .in('id', batch);
      if (error) throw new Error(`Could not update posts: ${error.message}`);
    }
  }

  // --- Account metrics -------------------------------------------------------
  const accountRows: TablesInsert<'account_metric_snapshots'>[] = [];
  for (const metric of input.accountMetrics ?? []) {
    const reason = checkMetricValue(metric, 'account');
    if (reason) {
      result.rejected.push({
        kind: 'account_metric',
        ref: `${metric.metricDate}/${metric.metricKey}`,
        reason,
      });
      continue;
    }
    accountRows.push({
      ...common,
      social_account_id: input.socialAccountId,
      metric_key: metric.metricKey,
      source_metric: metric.sourceMetric,
      value: metric.value,
      availability: metric.availability,
      period: metric.period,
      metric_date: metric.metricDate,
      captured_at: input.capturedAt,
      sync_run_id: input.syncRunId ?? null,
    });
  }
  for (const batch of chunks(accountRows)) {
    const { data, error } = await db
      .from('account_metric_snapshots')
      .upsert(batch, {
        onConflict: 'social_account_id,metric_key,period,metric_date,captured_at',
        ignoreDuplicates: true,
      })
      .select('id');
    if (error) throw new Error(`Could not store account metrics: ${error.message}`);
    result.accountMetricsWritten += data.length;
    result.duplicatesSkipped += batch.length - data.length;
  }

  return result;
}
