import 'server-only';
import { createClient, type ServerClient } from '@/lib/db/server';
import type { CalendarFilters, ContentStatus, DateRange } from './dates';

export type CalendarItem = {
  id: string;
  title: string;
  status: ContentStatus;
  plannedPublishAt: string | null;
  publishedAt: string | null;
  /** Where the item sits on the calendar: published_at when set, else planned_publish_at. */
  at: string | null;
  platformKeys: string[];
  countryCode: string | null;
  pillar: { name: string; color: string | null } | null;
  campaign: string | null;
  owner: string | null;
  assetCount: number;
  /** The first image of the current version, for a thumbnail. */
  imageAssetId: string | null;
};

export type CalendarItemDetail = CalendarItem & { caption: string | null };

const SELECT = `id, title, status, planned_publish_at, published_at, platform_keys, country_code,
  pillar:content_pillars(name, color),
  campaign:campaigns(name),
  owner:profiles!content_items_owner_user_id_fkey(full_name, email),
  version:content_versions!content_items_current_version_fk(caption,
    assets:content_assets(id, mime_type, position))`;

// Generous caps: a month of content for one organization is far below these.
const RANGE_LIMIT = 1000;
const UNSCHEDULED_LIMIT = 200;

type Row = {
  id: string;
  title: string;
  status: ContentStatus;
  planned_publish_at: string | null;
  published_at: string | null;
  platform_keys: string[];
  country_code: string | null;
  pillar: { name: string; color: string | null } | null;
  campaign: { name: string } | null;
  owner: { full_name: string | null; email: string } | null;
  version: {
    caption: string | null;
    assets: { id: string; mime_type: string; position: number }[];
  } | null;
};

function toItem(row: Row): CalendarItemDetail {
  const assets = [...(row.version?.assets ?? [])].sort((a, b) => a.position - b.position);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    plannedPublishAt: row.planned_publish_at,
    publishedAt: row.published_at,
    at: row.published_at ?? row.planned_publish_at,
    platformKeys: row.platform_keys,
    countryCode: row.country_code,
    pillar: row.pillar,
    campaign: row.campaign?.name ?? null,
    owner: row.owner ? row.owner.full_name || row.owner.email : null,
    assetCount: assets.length,
    imageAssetId: assets.find((a) => a.mime_type.startsWith('image/'))?.id ?? null,
    caption: row.version?.caption ?? null,
  };
}

function filtered(supabase: ServerClient, orgId: string, filters: CalendarFilters) {
  let query = supabase.from('content_items').select(SELECT).eq('organization_id', orgId);
  if (filters.country) query = query.eq('country_code', filters.country);
  if (filters.platform) query = query.contains('platform_keys', [filters.platform]);
  if (filters.owner) query = query.eq('owner_user_id', filters.owner);
  if (filters.pillar) query = query.eq('pillar_id', filters.pillar);
  if (filters.campaign) query = query.eq('campaign_id', filters.campaign);
  // Archived content stays out of the way unless someone asks for it.
  query = filters.status ? query.eq('status', filters.status) : query.neq('status', 'ARCHIVED');
  return query;
}

/**
 * Content items dated within `range` (published_at when set, else planned_publish_at),
 * sorted by that date. With `unscheduled`, also returns the items that have no date yet.
 */
export async function loadCalendar(
  orgId: string,
  range: DateRange,
  filters: CalendarFilters,
  { unscheduled = false }: { unscheduled?: boolean } = {},
): Promise<{ items: CalendarItem[]; unscheduled: CalendarItem[] }> {
  const supabase = await createClient();
  const start = range.start.toISOString();
  const end = range.end.toISOString();
  const [dated, undated] = await Promise.all([
    filtered(supabase, orgId, filters)
      .or(
        `and(published_at.gte.${start},published_at.lt.${end}),` +
          `and(published_at.is.null,planned_publish_at.gte.${start},planned_publish_at.lt.${end})`,
      )
      .limit(RANGE_LIMIT),
    unscheduled
      ? filtered(supabase, orgId, filters)
          .is('published_at', null)
          .is('planned_publish_at', null)
          .order('created_at', { ascending: false })
          .limit(UNSCHEDULED_LIMIT)
      : null,
  ]);
  if (dated.error) throw dated.error;
  if (undated?.error) throw undated.error;

  const items = (dated.data as unknown as Row[])
    .map(toItem)
    .sort((a, b) => a.at!.localeCompare(b.at!) || a.title.localeCompare(b.title));
  return {
    items,
    unscheduled: ((undated?.data ?? []) as unknown as Row[]).map(toItem),
  };
}

/** One item for the side panel, or null when it doesn't exist in this organization. */
export async function getCalendarItem(
  orgId: string,
  itemId: string,
): Promise<CalendarItemDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_items')
    .select(SELECT)
    .eq('organization_id', orgId)
    .eq('id', itemId)
    .maybeSingle();
  if (error) throw error;
  return data ? toItem(data as unknown as Row) : null;
}

/** Whether the organization has any content at all, archived included. */
export async function hasAnyContent(orgId: string): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('content_items')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export type CalendarFilterOptions = {
  countryCodes: string[];
  pillars: { id: string; name: string }[];
  campaigns: { id: string; name: string }[];
};

/** Choices for the filters: countries in use, and the organization's pillars and campaigns. */
export async function loadFilterOptions(orgId: string): Promise<CalendarFilterOptions> {
  const supabase = await createClient();
  const [countries, pillars, campaigns] = await Promise.all([
    supabase
      .from('content_items')
      .select('country_code')
      .eq('organization_id', orgId)
      .not('country_code', 'is', null)
      .limit(5000),
    supabase.from('content_pillars').select('id, name').eq('organization_id', orgId).order('name'),
    supabase.from('campaigns').select('id, name').eq('organization_id', orgId).order('name'),
  ]);
  if (countries.error) throw countries.error;
  if (pillars.error) throw pillars.error;
  if (campaigns.error) throw campaigns.error;
  return {
    countryCodes: [...new Set(countries.data.map((row) => row.country_code!))].sort(),
    pillars: pillars.data,
    campaigns: campaigns.data,
  };
}
