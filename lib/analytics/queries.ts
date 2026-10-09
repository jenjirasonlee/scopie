import 'server-only';
import { createClient, type ServerClient } from '@/lib/db/server';
import type { BenchmarkProfileData } from './benchmark';
import { comparisonSource, postSources } from './compare';
import { buildDashboard, type DashboardModel } from './dashboard';
import { ENGAGEMENT_AGE_DAYS } from './engagement';
import { DAY_MS, observationTime, periodsFor } from './range';
import type {
  FollowerObservation,
  PostRecord,
  ProfileRecord,
  ProfileSnapshotRecord,
} from './types';

const PAGE = 1000;

/** Reads every row of a query page by page (PostgREST caps a single response). */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  max = 50_000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export type DashboardData = {
  model: DashboardModel;
  hasViewer: boolean;
  countriesMissing: number;
};

/**
 * Loads stored observations for the dashboard and computes every number with the pure
 * functions in lib/analytics. Runs as the signed-in user, so RLS applies. Only values of the
 * organization's comparison source are read (public observations, or DEMO in a demo org).
 */
export async function loadDashboard(input: {
  orgId: string;
  orgSlug: string;
  isDemoOrg: boolean;
  days: number;
  now: Date;
}): Promise<DashboardData> {
  const supabase = await createClient();
  const source = comparisonSource(input.isDemoOrg);
  const { previous } = periodsFor(input.now, input.days);
  // Earliest instant any number on the page needs: the previous period, shifted back for
  // posts measured at 7 days.
  const since = new Date(previous.start.getTime() - ENGAGEMENT_AGE_DAYS * DAY_MS);
  const sinceDate = since.toISOString().slice(0, 10);

  const [accounts, viewers] = await Promise.all([
    supabase
      .from('social_accounts')
      .select(
        'id, display_name, handle, platform_key, business_role, access_type, country_code, is_active, first_observed_at, last_observed_at, earliest_post_at',
      )
      .eq('organization_id', input.orgId)
      .order('display_name'),
    supabase
      .from('public_data_viewers')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', input.orgId),
  ]);
  if (accounts.error) throw accounts.error;
  if (viewers.error) throw viewers.error;

  const profiles: ProfileRecord[] = accounts.data.map((a) => ({
    id: a.id,
    name: a.display_name,
    handle: a.handle,
    platformKey: a.platform_key,
    businessRole: a.business_role,
    accessType: a.access_type,
    countryCode: a.country_code,
    isActive: a.is_active,
    firstObservedAt: a.first_observed_at,
    lastObservedAt: a.last_observed_at,
    earliestPostAt: a.earliest_post_at,
  }));

  const [followers, posts, snapshots] = await Promise.all([
    loadFollowers(supabase, input.orgId, source, sinceDate),
    loadPosts(supabase, input.orgId, input.isDemoOrg, since),
    loadSnapshots(supabase, input.orgId, source),
  ]);
  await attachMetricsAtAge(supabase, input.orgId, source, since, posts);

  return {
    model: buildDashboard({
      orgSlug: input.orgSlug,
      isDemoOrg: input.isDemoOrg,
      now: input.now,
      days: input.days,
      profiles,
      followers,
      posts,
      snapshots,
    }),
    hasViewer: (viewers.count ?? 0) > 0,
    countriesMissing: profiles.filter((p) => p.isActive && !p.countryCode).length,
  };
}

async function loadFollowers(
  supabase: ServerClient,
  orgId: string,
  source: ReturnType<typeof comparisonSource>,
  sinceDate: string,
): Promise<Map<string, FollowerObservation[]>> {
  const rows = await fetchAll((from, to) =>
    supabase
      .from('account_metrics_daily')
      .select('social_account_id, metric_date, value, availability, data_source, captured_at')
      .eq('organization_id', orgId)
      .eq('metric_key', 'followers')
      .eq('data_source', source)
      .gte('metric_date', sinceDate)
      .order('metric_date')
      .order('social_account_id')
      .range(from, to),
  );
  const map = new Map<string, FollowerObservation[]>();
  for (const row of rows) {
    if (!row.social_account_id || !row.metric_date || !row.availability || !row.data_source) {
      continue;
    }
    const list = map.get(row.social_account_id) ?? [];
    list.push({
      at: observationTime(row.metric_date, row.captured_at),
      value: row.value,
      availability: row.availability,
      dataSource: row.data_source,
    });
    map.set(row.social_account_id, list);
  }
  return map;
}

async function loadPosts(
  supabase: ServerClient,
  orgId: string,
  isDemoOrg: boolean,
  since: Date,
): Promise<PostRecord[]> {
  const rows = await fetchAll((from, to) =>
    supabase
      .from('posts')
      .select(
        'id, social_account_id, published_at, media_format, permalink, caption, hashtags, data_source',
      )
      .eq('organization_id', orgId)
      .in('data_source', postSources(isDemoOrg))
      .is('removed_at', null)
      .gte('published_at', since.toISOString())
      .order('published_at')
      .order('id')
      .range(from, to),
  );
  return rows.map((p) => ({
    id: p.id,
    accountId: p.social_account_id,
    publishedAt: p.published_at,
    mediaFormat: p.media_format,
    permalink: p.permalink,
    caption: p.caption,
    hashtags: p.hashtags ?? [],
    dataSource: p.data_source,
  }));
}

/** Likes and comments at 7 days old, of the comparison source only. */
async function attachMetricsAtAge(
  supabase: ServerClient,
  orgId: string,
  source: ReturnType<typeof comparisonSource>,
  since: Date,
  posts: PostRecord[],
) {
  if (!posts.length) return;
  const byId = new Map(posts.map((p) => [p.id, p]));
  const rows = await fetchAll((from, to) =>
    supabase
      .from('post_metrics_at_age')
      .select('post_id, metric_key, value, availability, data_source')
      .eq('organization_id', orgId)
      .eq('age_days', ENGAGEMENT_AGE_DAYS)
      .eq('data_source', source)
      .in('metric_key', ['likes', 'comments'])
      .gte('captured_at', since.toISOString())
      .order('post_id')
      .order('metric_key')
      .range(from, to),
  );
  for (const row of rows) {
    const post = row.post_id ? byId.get(row.post_id) : undefined;
    if (!post || !row.availability || !row.data_source) continue;
    const value = { value: row.value, availability: row.availability, dataSource: row.data_source };
    if (row.metric_key === 'likes') post.likes = value;
    if (row.metric_key === 'comments') post.comments = value;
  }
}

async function loadSnapshots(
  supabase: ServerClient,
  orgId: string,
  source: ReturnType<typeof comparisonSource>,
): Promise<ProfileSnapshotRecord[]> {
  const rows = await fetchAll(
    (from, to) =>
      supabase
        .from('profile_snapshots')
        .select('social_account_id, observed_at, biography, website, data_source')
        .eq('organization_id', orgId)
        .eq('data_source', source)
        .order('observed_at')
        .order('id')
        .range(from, to),
    10_000,
  );
  return rows.map((s) => ({
    accountId: s.social_account_id,
    observedAt: s.observed_at,
    biography: s.biography,
    website: s.website,
    dataSource: s.data_source,
  }));
}

export type BenchmarkData = {
  source: ReturnType<typeof comparisonSource>;
  /** Every profile in the organization, active or not. */
  profiles: ProfileRecord[];
  /** Stored observations per profile, of the comparison source. */
  data: Map<string, BenchmarkProfileData>;
};

/**
 * Loads what benchmarks need for this period and the previous period of equal length:
 * profiles, follower observations and posts with likes + comments at 7 days old. Runs as
 * the signed-in user (RLS applies) and reads only the organization's comparison source.
 */
export async function loadBenchmarkData(input: {
  orgId: string;
  isDemoOrg: boolean;
  days: number;
  now: Date;
  /** Another client, e.g. the service role for scheduled jobs. Defaults to the signed-in user. */
  db?: ServerClient;
}): Promise<BenchmarkData> {
  const supabase = input.db ?? (await createClient());
  const source = comparisonSource(input.isDemoOrg);
  const { previous } = periodsFor(input.now, input.days);
  const since = new Date(previous.start.getTime() - ENGAGEMENT_AGE_DAYS * DAY_MS);

  const accounts = await supabase
    .from('social_accounts')
    .select(
      'id, display_name, handle, platform_key, business_role, access_type, country_code, is_active, first_observed_at, last_observed_at, earliest_post_at',
    )
    .eq('organization_id', input.orgId)
    .order('display_name');
  if (accounts.error) throw accounts.error;
  const profiles: ProfileRecord[] = accounts.data.map((a) => ({
    id: a.id,
    name: a.display_name,
    handle: a.handle,
    platformKey: a.platform_key,
    businessRole: a.business_role,
    accessType: a.access_type,
    countryCode: a.country_code,
    isActive: a.is_active,
    firstObservedAt: a.first_observed_at,
    lastObservedAt: a.last_observed_at,
    earliestPostAt: a.earliest_post_at,
  }));

  const [followers, posts] = await Promise.all([
    loadFollowers(supabase, input.orgId, source, previous.start.toISOString().slice(0, 10)),
    loadPosts(supabase, input.orgId, input.isDemoOrg, since),
  ]);
  await attachMetricsAtAge(supabase, input.orgId, source, since, posts);

  const postsByAccount = new Map<string, PostRecord[]>();
  for (const post of posts) {
    const list = postsByAccount.get(post.accountId) ?? [];
    list.push(post);
    postsByAccount.set(post.accountId, list);
  }
  return {
    source,
    profiles,
    data: new Map(
      profiles.map((profile) => [
        profile.id,
        {
          profile,
          followers: followers.get(profile.id) ?? [],
          posts: postsByAccount.get(profile.id) ?? [],
        },
      ]),
    ),
  };
}
