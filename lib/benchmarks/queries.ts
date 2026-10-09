import 'server-only';
import type { ProfileRecord } from '@/lib/analytics/types';
import { createClient } from '@/lib/db/server';

export type BenchmarkGroup = {
  id: string;
  name: string;
  createdAt: string;
  /** Profile ids in the group. */
  memberIds: string[];
};

/**
 * The organization's benchmark groups (kind 'custom') with their members. Runs as the
 * signed-in user: every member can read groups; RLS limits writes to accounts.manage.
 */
export async function listBenchmarkGroups(orgId: string): Promise<BenchmarkGroup[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('account_groups')
    .select('id, name, created_at, account_group_members(social_account_id)')
    .eq('organization_id', orgId)
    .eq('kind', 'custom')
    .order('name');
  if (error) throw error;
  return data.map((group) => ({
    id: group.id,
    name: group.name,
    createdAt: group.created_at,
    memberIds: group.account_group_members.map((m) => m.social_account_id),
  }));
}

/** The organization's profiles (active or not), as analytics records. */
export async function listGroupableProfiles(orgId: string): Promise<ProfileRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('social_accounts')
    .select(
      'id, display_name, handle, platform_key, business_role, access_type, country_code, is_active, first_observed_at, last_observed_at, earliest_post_at',
    )
    .eq('organization_id', orgId)
    .order('display_name');
  if (error) throw error;
  return data.map((a) => ({
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
}
