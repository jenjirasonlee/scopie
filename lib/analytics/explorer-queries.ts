import 'server-only';
import { createClient } from '@/lib/db/server';
import { comparisonSource } from './compare';
import type { ExplorerPost, StoredPostMetric } from './explorer';
import { fetchAll } from './queries';
import type { DataSource, Period, ProfileRecord } from './types';

export type ExplorerData = {
  posts: ExplorerPost[];
  /** Sources with stored post values in the period, the comparison source first. */
  sources: DataSource[];
  pillars: { id: string; name: string }[];
  campaigns: { id: string; name: string }[];
  /** Definitions from metric_definitions, by key. */
  definitions: Map<string, string>;
};

/**
 * Loads stored posts published in the period with their latest stored value of every metric
 * (post_metrics_latest, one row per source). Runs as the signed-in user, so RLS applies.
 * A demo organization only reads DEMO values; estimated values are never read.
 */
export async function loadExplorerData(input: {
  orgId: string;
  isDemoOrg: boolean;
  period: Period;
}): Promise<ExplorerData> {
  const supabase = await createClient();
  const since = input.period.start.toISOString();
  const valueSources: DataSource[] = input.isDemoOrg
    ? ['demo']
    : ['live_public', 'live_connected', 'imported'];

  const [accounts, pillars, campaigns, definitions] = await Promise.all([
    supabase
      .from('social_accounts')
      .select(
        'id, display_name, handle, platform_key, business_role, access_type, country_code, is_active, first_observed_at, last_observed_at, earliest_post_at',
      )
      .eq('organization_id', input.orgId)
      .order('display_name'),
    supabase
      .from('content_pillars')
      .select('id, name')
      .eq('organization_id', input.orgId)
      .order('name'),
    supabase.from('campaigns').select('id, name').eq('organization_id', input.orgId).order('name'),
    supabase.from('metric_definitions').select('key, definition').eq('applies_to_posts', true),
  ]);
  for (const result of [accounts, pillars, campaigns, definitions]) {
    if (result.error) throw result.error;
  }

  const profiles = new Map<string, ProfileRecord>(
    (accounts.data ?? []).map((a) => [
      a.id,
      {
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
      },
    ]),
  );

  const [postRows, metricRows] = await Promise.all([
    fetchAll((from, to) =>
      supabase
        .from('posts')
        .select(
          'id, social_account_id, published_at, media_format, permalink, caption, country_code, pillar_id, campaign_id',
        )
        .eq('organization_id', input.orgId)
        .in('data_source', valueSources)
        .is('removed_at', null)
        .gte('published_at', since)
        .lt('published_at', input.period.end.toISOString())
        .order('published_at', { ascending: false })
        .order('id')
        .range(from, to),
    ),
    // A post's snapshots are captured after it was published, so this covers every post above.
    fetchAll((from, to) =>
      supabase
        .from('post_metrics_latest')
        .select('post_id, metric_key, value, availability, data_source')
        .eq('organization_id', input.orgId)
        .in('data_source', valueSources)
        .gte('captured_at', since)
        .order('post_id')
        .order('metric_key')
        .order('data_source')
        .range(from, to),
    ),
  ]);

  const metrics = new Map<string, StoredPostMetric[]>();
  const found = new Set<DataSource>();
  for (const row of metricRows) {
    if (!row.post_id || !row.metric_key || !row.availability || !row.data_source) continue;
    const list = metrics.get(row.post_id) ?? [];
    list.push({
      metricKey: row.metric_key,
      value: row.value,
      availability: row.availability,
      dataSource: row.data_source,
    });
    metrics.set(row.post_id, list);
  }

  const posts: ExplorerPost[] = [];
  for (const row of postRows) {
    const profile = profiles.get(row.social_account_id);
    if (!profile) continue;
    const values = metrics.get(row.id) ?? [];
    for (const value of values) found.add(value.dataSource);
    posts.push({
      id: row.id,
      profile,
      publishedAt: row.published_at,
      mediaFormat: row.media_format,
      permalink: row.permalink,
      caption: row.caption,
      countryCode: row.country_code ?? profile.countryCode,
      pillarId: row.pillar_id,
      campaignId: row.campaign_id,
      metrics: values,
    });
  }

  const preferred = comparisonSource(input.isDemoOrg);
  return {
    posts,
    sources: valueSources
      .filter((s) => found.has(s))
      .sort((a, b) => Number(b === preferred) - Number(a === preferred)),
    pillars: pillars.data ?? [],
    campaigns: campaigns.data ?? [],
    definitions: new Map((definitions.data ?? []).map((d) => [d.key, d.definition])),
  };
}
