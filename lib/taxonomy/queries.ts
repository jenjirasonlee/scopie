import 'server-only';
import { createClient } from '@/lib/db/server';
import {
  activeFirst,
  byName,
  isPillarColor,
  type Campaign,
  type Pillar,
  type Taxonomy,
  type TaxonomyItem,
} from './shared';

const COLUMNS = 'id, name, description, is_active, created_at';

type Row = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
};

function toItem(row: Row): TaxonomyItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

/**
 * Runs as the signed-in user: every member can read the taxonomy; RLS limits writes to
 * strategy.manage and nobody can delete (items are deactivated instead).
 */
async function loadTaxonomy(orgId: string, activeOnly: boolean): Promise<Taxonomy> {
  const supabase = await createClient();
  const states = activeOnly ? [true] : [true, false];
  const [pillars, formats, campaigns, audiences, ctaTypes] = await Promise.all([
    supabase
      .from('content_pillars')
      .select(`${COLUMNS}, color`)
      .eq('organization_id', orgId)
      .in('is_active', states),
    supabase
      .from('content_formats')
      .select(COLUMNS)
      .eq('organization_id', orgId)
      .in('is_active', states),
    supabase
      .from('campaigns')
      .select(`${COLUMNS}, starts_on, ends_on`)
      .eq('organization_id', orgId)
      .in('is_active', states),
    supabase.from('audiences').select(COLUMNS).eq('organization_id', orgId).in('is_active', states),
    supabase.from('cta_types').select(COLUMNS).eq('organization_id', orgId).in('is_active', states),
  ]);
  for (const result of [pillars, formats, campaigns, audiences, ctaTypes]) {
    if (result.error) throw result.error;
  }
  const order = activeOnly ? byName : activeFirst;
  return {
    pillars: (pillars.data ?? [])
      .map((row): Pillar => ({
        ...toItem(row),
        color: isPillarColor(row.color) ? row.color : null,
      }))
      .sort(order),
    formats: (formats.data ?? []).map(toItem).sort(order),
    campaigns: (campaigns.data ?? [])
      .map((row): Campaign => ({ ...toItem(row), startsOn: row.starts_on, endsOn: row.ends_on }))
      .sort(order),
    audiences: (audiences.data ?? []).map(toItem).sort(order),
    ctaTypes: (ctaTypes.data ?? []).map(toItem).sort(order),
  };
}

/** Every taxonomy item of the organization, active first, then by name. For the settings page. */
export function listTaxonomy(orgId: string): Promise<Taxonomy> {
  return loadTaxonomy(orgId, false);
}

/** Only active items, by name: the choices for tagging content and filtering the calendar. */
export function listActiveTaxonomy(orgId: string): Promise<Taxonomy> {
  return loadTaxonomy(orgId, true);
}
