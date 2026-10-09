import { createClient } from '@/lib/db/server';
import type { Tables } from '@/lib/db/types';

export type PlatformConnection = Pick<
  Tables<'platform_connections'>,
  | 'id'
  | 'provider'
  | 'display_name'
  | 'status'
  | 'scopes'
  | 'token_expires_at'
  | 'last_error'
  | 'created_at'
>;
export type ConnectionAsset = Pick<
  Tables<'connection_assets'>,
  | 'id'
  | 'connection_id'
  | 'platform_key'
  | 'external_id'
  | 'name'
  | 'handle'
  | 'account_type'
  | 'linked_account_id'
>;

/** Connections and the platform accounts each one can read. Never includes tokens. */
export async function listConnections(orgId: string) {
  const supabase = await createClient();
  const [connections, assets] = await Promise.all([
    supabase
      .from('platform_connections')
      .select(
        'id, provider, display_name, status, scopes, token_expires_at, last_error, created_at',
      )
      .eq('organization_id', orgId)
      .order('created_at'),
    supabase
      .from('connection_assets')
      .select(
        'id, connection_id, platform_key, external_id, name, handle, account_type, linked_account_id',
      )
      .eq('organization_id', orgId)
      .order('platform_key')
      .order('name'),
  ]);
  if (connections.error) throw connections.error;
  if (assets.error) throw assets.error;
  return {
    connections: connections.data as PlatformConnection[],
    assets: assets.data as ConnectionAsset[],
  };
}
