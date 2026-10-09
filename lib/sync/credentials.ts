import { decryptToken } from '@/lib/crypto/tokens';
import type { Db } from '@/lib/ingest/ingest';
import { AuthError, PlatformError } from '@/lib/platforms/errors';
import type { AccountContext, PublicContext } from '@/lib/platforms/types';

type AccountForContext = {
  id: string;
  platform_key: string;
  external_id: string | null;
  account_type: string | null;
  connection_id: string | null;
};

/**
 * Builds the connector context for an account: finds the asset it is linked to and
 * decrypts the matching token. Facebook Pages use their own Page token; Instagram
 * accounts use the token of the Page they are linked to. Requires the service role.
 * The decrypted token lives only in memory for the duration of the job.
 */
export async function loadAccountContext(
  db: Db,
  account: AccountForContext,
  encryptionKey: string,
): Promise<AccountContext> {
  if (!account.connection_id || !account.external_id) {
    throw new AuthError('The account is not connected');
  }
  const { data: connection, error: connectionError } = await db
    .from('platform_connections')
    .select('id, status')
    .eq('id', account.connection_id)
    .single();
  if (connectionError) throw new Error(`Could not load the connection: ${connectionError.message}`);
  if (connection.status !== 'active') throw new AuthError('The connection is not active');

  const { data: asset, error: assetError } = await db
    .from('connection_assets')
    .select('external_id, parent_external_id')
    .eq('connection_id', account.connection_id)
    .eq('platform_key', account.platform_key)
    .eq('external_id', account.external_id)
    .maybeSingle();
  if (assetError) throw new Error(`Could not load the connected asset: ${assetError.message}`);
  if (!asset) throw new AuthError('The platform account is no longer available to this connection');

  const tokenOwner = asset.parent_external_id ?? asset.external_id;
  const { data: credential, error: credentialError } = await db
    .from('connection_credentials')
    .select('ciphertext')
    .eq('connection_id', account.connection_id)
    .eq('asset_external_id', tokenOwner)
    .maybeSingle();
  if (credentialError) throw new Error(`Could not load credentials: ${credentialError.message}`);
  if (!credential) throw new AuthError('No access token is stored for this account');

  return {
    platformKey: account.platform_key,
    externalId: account.external_id,
    accountType: account.account_type,
    accessToken: decryptToken(credential.ciphertext, encryptionKey),
  };
}

/**
 * Builds the context for reading public profiles: the organization's viewer account and
 * its token. The viewer is any Instagram professional account the organization connected;
 * the profiles it reads authorize nothing. Requires the service role. Never sent to a browser.
 */
export async function loadPublicContext(
  db: Db,
  organizationId: string,
  platformKey: string,
  encryptionKey: string,
): Promise<PublicContext> {
  const { data: viewer, error } = await db
    .from('public_data_viewers')
    .select('connection_assets!inner(connection_id, external_id, parent_external_id)')
    .eq('organization_id', organizationId)
    .eq('platform_key', platformKey)
    .maybeSingle();
  if (error) throw new Error(`Could not load the viewer account: ${error.message}`);
  if (!viewer) {
    throw new PlatformError('No viewer account is set up for public data', 'no_viewer');
  }
  const asset = viewer.connection_assets;
  const { data: connection, error: connectionError } = await db
    .from('platform_connections')
    .select('status')
    .eq('id', asset.connection_id)
    .single();
  if (connectionError) throw new Error(`Could not load the connection: ${connectionError.message}`);
  if (connection.status !== 'active') {
    throw new AuthError('The viewer account’s connection needs to be reconnected');
  }
  const tokenOwner = asset.parent_external_id ?? asset.external_id;
  const { data: credential, error: credentialError } = await db
    .from('connection_credentials')
    .select('ciphertext')
    .eq('connection_id', asset.connection_id)
    .eq('asset_external_id', tokenOwner)
    .maybeSingle();
  if (credentialError) throw new Error(`Could not load credentials: ${credentialError.message}`);
  if (!credential) throw new AuthError('No access token is stored for the viewer account');
  return {
    viewerId: asset.external_id,
    connectionId: asset.connection_id,
    credential: decryptToken(credential.ciphertext, encryptionKey),
  };
}
