import { encryptToken, CURRENT_KEY_VERSION } from '@/lib/crypto/tokens';
import type { Db } from '@/lib/ingest/ingest';
import { MetaOAuth, META_SCOPES, type MetaAsset } from '@/lib/platforms/meta/oauth';
import type { MetaConfig } from '@/lib/server-env';

export type CompleteMetaConnectionInput = {
  /** Service-role client: stores tokens no user can read. */
  admin: Db;
  /** The signed-in user's client: links accounts through permission-checked functions. */
  userClient: Db;
  organizationId: string;
  userId: string;
  code: string;
  redirectUri: string;
  config: MetaConfig;
  encryptionKey: string;
  oauth?: MetaOAuth;
};

export type CompleteMetaConnectionResult = {
  connectionId: string;
  assets: number;
  autoLinked: number;
  missingScopes: string[];
};

/**
 * Finishes "Connect with Meta": swaps the code for a long-lived token, finds the
 * Pages and Instagram accounts it can see, stores every token encrypted, and links
 * Scopie accounts that already match (same platform ID, or same Instagram handle).
 * Tokens never leave the server and are never logged.
 */
export async function completeMetaConnection(
  input: CompleteMetaConnectionInput,
): Promise<CompleteMetaConnectionResult> {
  const oauth = input.oauth ?? new MetaOAuth(input.config);
  const shortLived = await oauth.exchangeCode(input.code, input.redirectUri);
  const userToken = await oauth.exchangeLongLived(shortLived.accessToken);
  const me = await oauth.me(userToken.accessToken);
  const scopes = await oauth.grantedScopes(userToken.accessToken);
  const assets = await oauth.discoverAssets(userToken.accessToken);
  const missingScopes = META_SCOPES.map((entry) => entry.scope).filter(
    (scope) => !scopes.includes(scope),
  );

  const { data: connection, error: connectionError } = await input.admin
    .from('platform_connections')
    .upsert(
      {
        organization_id: input.organizationId,
        provider: 'meta',
        external_user_id: me.id,
        display_name: me.name ?? null,
        status: 'active',
        scopes,
        token_expires_at: userToken.expiresAt?.toISOString() ?? null,
        last_refreshed_at: new Date().toISOString(),
        last_error: null,
        connected_by: input.userId,
      },
      { onConflict: 'organization_id,provider,external_user_id' },
    )
    .select('id')
    .single();
  if (connectionError) throw new Error(`Could not save the connection: ${connectionError.message}`);

  await storeCredentials(input, connection.id, userToken.accessToken, userToken.expiresAt, assets);

  const { data: storedAssets, error: assetError } = await input.admin
    .from('connection_assets')
    .upsert(
      assets.map((asset) => ({
        organization_id: input.organizationId,
        connection_id: connection.id,
        platform_key: asset.platformKey,
        external_id: asset.externalId,
        name: asset.name,
        handle: asset.handle,
        account_type: asset.accountType,
        parent_external_id: asset.parentExternalId,
        discovered_at: new Date().toISOString(),
      })),
      { onConflict: 'connection_id,platform_key,external_id' },
    )
    .select('id, platform_key, external_id, handle, linked_account_id');
  if (assetError) throw new Error(`Could not save discovered accounts: ${assetError.message}`);

  // A reconnect brings accounts that were waiting for it back to "connected".
  await input.admin
    .from('social_accounts')
    .update({ connection_status: 'connected' })
    .eq('connection_id', connection.id)
    .eq('connection_status', 'needs_reauth');

  const autoLinked = await autoLink(input, storedAssets);
  return { connectionId: connection.id, assets: storedAssets.length, autoLinked, missingScopes };
}

async function storeCredentials(
  input: CompleteMetaConnectionInput,
  connectionId: string,
  userToken: string,
  userTokenExpiresAt: Date | null,
  assets: MetaAsset[],
) {
  const seal = (token: string) => encryptToken(token, input.encryptionKey);
  const rows = [
    {
      connection_id: connectionId,
      organization_id: input.organizationId,
      asset_external_id: null as string | null,
      ciphertext: seal(userToken),
      key_version: CURRENT_KEY_VERSION,
      expires_at: userTokenExpiresAt?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    },
  ];
  for (const asset of assets) {
    // One token per Facebook Page; Instagram accounts use their Page's token.
    if (asset.platformKey !== 'facebook' || !asset.accessToken) continue;
    rows.push({
      connection_id: connectionId,
      organization_id: input.organizationId,
      asset_external_id: asset.externalId,
      ciphertext: seal(asset.accessToken),
      key_version: CURRENT_KEY_VERSION,
      expires_at: null,
      updated_at: new Date().toISOString(),
    });
  }
  const { error } = await input.admin
    .from('connection_credentials')
    .upsert(rows, { onConflict: 'connection_id,asset_external_id' });
  if (error) throw new Error(`Could not store credentials: ${error.message}`);
}

async function autoLink(
  input: CompleteMetaConnectionInput,
  assets: {
    id: string;
    platform_key: string;
    external_id: string;
    handle: string | null;
    linked_account_id: string | null;
  }[],
): Promise<number> {
  const { data: accounts, error } = await input.userClient
    .from('social_accounts')
    .select('id, platform_key, external_id, handle, connection_id, business_role')
    .eq('organization_id', input.organizationId)
    .in('platform_key', ['instagram', 'facebook'])
    .eq('business_role', 'owned');
  if (error) throw new Error(`Could not read accounts: ${error.message}`);

  let linked = 0;
  for (const asset of assets) {
    if (asset.linked_account_id) continue;
    const match =
      accounts.find(
        (account) =>
          account.platform_key === asset.platform_key && account.external_id === asset.external_id,
      ) ??
      accounts.find(
        (account) =>
          account.platform_key === asset.platform_key &&
          !account.external_id &&
          asset.handle &&
          account.handle?.toLowerCase() === asset.handle.toLowerCase(),
      );
    if (!match || match.connection_id) continue;
    const { error: linkError } = await input.userClient.rpc('link_connection_asset', {
      asset_id: asset.id,
      account_id: match.id,
    });
    if (!linkError) linked += 1;
  }
  return linked;
}

/** Best-effort revoke at Meta, using the stored user token. */
export async function revokeMetaConnection(input: {
  admin: Db;
  connectionId: string;
  config: MetaConfig;
  encryptionKey: string;
  decrypt: (sealed: string, key: string) => string;
  oauth?: MetaOAuth;
}): Promise<boolean> {
  const { data } = await input.admin
    .from('connection_credentials')
    .select('ciphertext')
    .eq('connection_id', input.connectionId)
    .is('asset_external_id', null)
    .maybeSingle();
  if (!data) return false;
  try {
    const oauth = input.oauth ?? new MetaOAuth(input.config);
    await oauth.revoke(input.decrypt(data.ciphertext, input.encryptionKey));
    return true;
  } catch {
    return false;
  }
}
