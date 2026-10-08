import 'server-only';
import { createClient } from '@/lib/db/server';
import type { Tables } from '@/lib/db/types';
import type { ContentFilters, ContentStatus } from './shared';

export type ContentListItem = {
  id: string;
  title: string;
  status: ContentStatus;
  platformKeys: string[];
  countryCode: string | null;
  plannedPublishAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  pillar: { name: string; color: string | null } | null;
  campaign: { name: string } | null;
  owner: { name: string } | null;
  versionNumber: number | null;
  assetCount: number;
};

const LIST_SELECT = `
  id, title, status, platform_keys, country_code, planned_publish_at, published_at, updated_at,
  current_version_id,
  content_pillars(name, color),
  campaigns(name),
  owner:profiles!content_items_owner_user_id_fkey(full_name, email),
  current_version:content_versions!content_items_current_version_fk(version_number, content_assets(count))
`;

export async function listContentItems(
  orgId: string,
  filters: ContentFilters,
): Promise<ContentListItem[]> {
  const supabase = await createClient();
  let query = supabase
    .from('content_items')
    .select(LIST_SELECT)
    .eq('organization_id', orgId)
    .order('planned_publish_at', { ascending: true, nullsFirst: false })
    .order('updated_at', { ascending: false })
    .limit(500);
  if (filters.q) query = query.ilike('title', `%${filters.q.replace(/[%_\\]/g, '\\$&')}%`);
  if (filters.status) query = query.eq('status', filters.status);
  else if (!filters.archived) query = query.neq('status', 'ARCHIVED');
  if (filters.platform) query = query.contains('platform_keys', [filters.platform]);
  if (filters.country) query = query.eq('country_code', filters.country);
  if (filters.pillar) query = query.eq('pillar_id', filters.pillar);
  if (filters.campaign) query = query.eq('campaign_id', filters.campaign);
  if (filters.owner) query = query.eq('owner_user_id', filters.owner);
  const { data, error } = await query;
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    platformKeys: row.platform_keys,
    countryCode: row.country_code,
    plannedPublishAt: row.planned_publish_at,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    pillar: row.content_pillars,
    campaign: row.campaigns,
    owner: row.owner ? { name: row.owner.full_name ?? row.owner.email } : null,
    versionNumber: row.current_version?.version_number ?? null,
    assetCount: row.current_version?.content_assets[0]?.count ?? 0,
  }));
}

export async function countContentItems(orgId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('content_items')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId);
  if (error) throw error;
  return count ?? 0;
}

export type ContentItem = Tables<'content_items'>;
export type ContentVersion = Tables<'content_versions'>;
export type ContentAsset = Tables<'content_assets'>;

export type ContentVersionSummary = Pick<
  ContentVersion,
  'id' | 'version_number' | 'created_at' | 'updated_at' | 'submitted_at'
> & { authorName: string | null; assetCount: number };

export type ContentDetail = {
  item: ContentItem;
  /** The version being shown: the current one, or an earlier one when asked for. */
  version: ContentVersion;
  isCurrentVersion: boolean;
  assets: ContentAsset[];
  versions: ContentVersionSummary[];
};

/** One item with the requested version (default: current), its assets and version history. */
export async function getContentDetail(
  orgId: string,
  itemId: string,
  versionNumber?: number,
): Promise<ContentDetail | null> {
  const supabase = await createClient();
  const { data: item, error } = await supabase
    .from('content_items')
    .select('*')
    .eq('organization_id', orgId)
    .eq('id', itemId)
    .maybeSingle();
  if (error) throw error;
  if (!item) return null;

  const { data: versionRows, error: versionError } = await supabase
    .from('content_versions')
    .select(
      '*, author:profiles!content_versions_created_by_fkey(full_name, email), content_assets(count)',
    )
    .eq('content_item_id', itemId)
    .order('version_number', { ascending: false });
  if (versionError) throw versionError;

  const version =
    versionRows.find((row) =>
      versionNumber ? row.version_number === versionNumber : row.id === item.current_version_id,
    ) ?? null;
  if (!version) return null;

  const { data: assets, error: assetError } = await supabase
    .from('content_assets')
    .select('*')
    .eq('content_version_id', version.id)
    .order('position')
    .order('created_at');
  if (assetError) throw assetError;

  const versionFields: ContentVersion = {
    id: version.id,
    organization_id: version.organization_id,
    content_item_id: version.content_item_id,
    version_number: version.version_number,
    description: version.description,
    caption: version.caption,
    cta: version.cta,
    hashtags: version.hashtags,
    notes: version.notes,
    created_by: version.created_by,
    created_at: version.created_at,
    updated_at: version.updated_at,
    submitted_at: version.submitted_at,
  };
  return {
    item,
    version: versionFields,
    isCurrentVersion: version.id === item.current_version_id,
    assets,
    versions: versionRows.map((row) => ({
      id: row.id,
      version_number: row.version_number,
      created_at: row.created_at,
      updated_at: row.updated_at,
      submitted_at: row.submitted_at,
      authorName: row.author ? (row.author.full_name ?? row.author.email) : null,
      assetCount: row.content_assets[0]?.count ?? 0,
    })),
  };
}

/** Taxonomy choices for the content form and filters: active items, plus any already used. */
export async function getContentFormOptions(orgId: string) {
  const supabase = await createClient();
  const select = 'id, name, is_active';
  const [pillars, formats, campaigns, audiences, ctaTypes] = await Promise.all([
    supabase
      .from('content_pillars')
      .select(`${select}, color`)
      .eq('organization_id', orgId)
      .order('name'),
    supabase.from('content_formats').select(select).eq('organization_id', orgId).order('name'),
    supabase.from('campaigns').select(select).eq('organization_id', orgId).order('name'),
    supabase.from('audiences').select(select).eq('organization_id', orgId).order('name'),
    supabase.from('cta_types').select(select).eq('organization_id', orgId).order('name'),
  ]);
  for (const result of [pillars, formats, campaigns, audiences, ctaTypes]) {
    if (result.error) throw result.error;
  }
  const options = (rows: { id: string; name: string; is_active: boolean }[] | null) =>
    (rows ?? []).map((row) => ({ value: row.id, label: row.name, active: row.is_active }));
  return {
    pillars: options(pillars.data),
    formats: options(formats.data),
    campaigns: options(campaigns.data),
    audiences: options(audiences.data),
    ctaTypes: options(ctaTypes.data),
  };
}

export type ContentFormOptions = Awaited<ReturnType<typeof getContentFormOptions>>;
