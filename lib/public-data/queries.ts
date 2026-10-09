import 'server-only';
import { createClient } from '@/lib/db/server';

export type PublicDataViewer = {
  assetId: string;
  name: string | null;
  handle: string | null;
  connectionStatus: string;
};

/** The organization's viewer account for public Instagram data, if one is chosen. */
export async function getPublicDataViewer(orgId: string): Promise<PublicDataViewer | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('public_data_viewers')
    .select(
      'connection_asset_id, connection_assets!inner(name, handle, platform_connections!inner(status))',
    )
    .eq('organization_id', orgId)
    .eq('platform_key', 'instagram')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    assetId: data.connection_asset_id,
    name: data.connection_assets.name,
    handle: data.connection_assets.handle,
    connectionStatus: data.connection_assets.platform_connections.status,
  };
}
