import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/db/server';
import type { Tables } from '@/lib/db/types';
import type { AccountFilters } from './filters';

export type SocialAccount = Tables<'social_accounts'>;
export type Platform = Tables<'platforms'>;
export type Country = Tables<'countries'>;

export type SocialAccountListItem = SocialAccount & {
  owner: { full_name: string | null; email: string } | null;
};

export const listPlatforms = cache(async (): Promise<Platform[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from('platforms').select('*').order('sort_order');
  if (error) throw error;
  return data;
});

export const listCountries = cache(async (): Promise<Country[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from('countries').select('*').order('name');
  if (error) throw error;
  return data;
});

export async function listAccounts(
  orgId: string,
  filters: AccountFilters,
): Promise<SocialAccountListItem[]> {
  const supabase = await createClient();
  let query = supabase
    .from('social_accounts')
    .select('*, owner:profiles!social_accounts_owner_user_id_fkey(full_name, email)')
    .eq('organization_id', orgId)
    .order('display_name')
    .order('platform_key');

  if (filters.platform) query = query.eq('platform_key', filters.platform);
  if (filters.country) query = query.eq('country_code', filters.country);
  if (filters.status === 'active') query = query.eq('is_active', true);
  if (filters.status === 'inactive') query = query.eq('is_active', false);
  if (filters.q) {
    // Escape PostgREST filter syntax characters before building the or() clause.
    const term = filters.q.replace(/[%,()*\\]/g, ' ').trim();
    if (term) query = query.or(`display_name.ilike.%${term}%,handle.ilike.%${term}%`);
  }

  const { data, error } = await query.limit(500);
  if (error) throw error;
  return data;
}

export async function getAccount(orgId: string, accountId: string): Promise<SocialAccount | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('social_accounts')
    .select('*')
    .eq('organization_id', orgId)
    .eq('id', accountId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export type AccountSummary = {
  total: number;
  active: number;
  inactive: number;
  byCountry: { code: string | null; count: number }[];
  byPlatform: { key: string; count: number }[];
  byConnection: Record<string, number>;
  demoCount: number;
};

export async function getAccountSummary(orgId: string): Promise<AccountSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('social_accounts')
    .select('country_code, platform_key, is_active, connection_status, primary_data_source')
    .eq('organization_id', orgId);
  if (error) throw error;
  return summarizeAccounts(data);
}

export function summarizeAccounts(
  rows: Pick<
    SocialAccount,
    'country_code' | 'platform_key' | 'is_active' | 'connection_status' | 'primary_data_source'
  >[],
): AccountSummary {
  const countries = new Map<string | null, number>();
  const platforms = new Map<string, number>();
  const byConnection: Record<string, number> = {};
  let active = 0;
  let demoCount = 0;
  for (const row of rows) {
    if (row.is_active) active++;
    if (row.primary_data_source === 'demo') demoCount++;
    countries.set(row.country_code, (countries.get(row.country_code) ?? 0) + 1);
    platforms.set(row.platform_key, (platforms.get(row.platform_key) ?? 0) + 1);
    byConnection[row.connection_status] = (byConnection[row.connection_status] ?? 0) + 1;
  }
  const desc = <K>(entries: [K, number][]) => entries.sort((a, b) => b[1] - a[1]);
  return {
    total: rows.length,
    active,
    inactive: rows.length - active,
    byCountry: desc([...countries.entries()]).map(([code, count]) => ({ code, count })),
    byPlatform: desc([...platforms.entries()]).map(([key, count]) => ({ key, count })),
    byConnection,
    demoCount,
  };
}
