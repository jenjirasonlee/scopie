'use server';

import { revalidatePath } from 'next/cache';
import { can } from '@/lib/auth/permissions';
import { decryptToken } from '@/lib/crypto/tokens';
import { createAdminClient } from '@/lib/db/admin';
import { createClient } from '@/lib/db/server';
import type { FormState } from '@/lib/forms';
import { getOrgContext } from '@/lib/orgs/queries';
import { metaConfig, serverEnv } from '@/lib/server-env';
import { revokeMetaConnection } from './meta';

const NO_PERMISSION: FormState = {
  status: 'error',
  message: 'Only owners and admins can manage connections.',
};

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** Links a discovered platform account to a Scopie account so it starts syncing. */
export async function linkAsset(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) return NO_PERMISSION;
  const assetId = field(formData, 'assetId');
  const accountId = field(formData, 'accountId');
  if (!assetId || !accountId)
    return { status: 'error', message: 'Choose a Scopie account to link.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('link_connection_asset', {
    asset_id: assetId,
    account_id: accountId,
  });
  if (error) {
    return {
      status: 'error',
      message:
        error.code === '23514' || error.code === '23505'
          ? `${error.message}.`
          : 'Could not link this account. Please try again.',
    };
  }
  revalidatePath(`/${orgSlug}`, 'layout');
  return { status: 'success', message: 'Linked. Data starts arriving on the next sync run.' };
}

export async function unlinkAccount(orgSlug: string, formData: FormData): Promise<void> {
  const { role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) return;
  const supabase = await createClient();
  await supabase.rpc('unlink_social_account', { account_id: field(formData, 'accountId') });
  revalidatePath(`/${orgSlug}`, 'layout');
}

/**
 * Disconnects a platform login: revokes the token at Meta (best effort), deletes the
 * stored tokens and stops syncing. Data already collected stays.
 */
export async function disconnectConnection(orgSlug: string, formData: FormData): Promise<void> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) return;
  const connectionId = field(formData, 'connectionId');
  const supabase = await createClient();
  const { data: connection } = await supabase
    .from('platform_connections')
    .select('id, provider')
    .eq('organization_id', org.id)
    .eq('id', connectionId)
    .maybeSingle();
  if (!connection) return;

  const env = serverEnv();
  const config = metaConfig(env);
  if (
    connection.provider === 'meta' &&
    config &&
    env.SCOPIE_ENCRYPTION_KEY &&
    env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    await revokeMetaConnection({
      admin: createAdminClient(),
      connectionId: connection.id,
      config,
      encryptionKey: env.SCOPIE_ENCRYPTION_KEY,
      decrypt: decryptToken,
    });
  }
  await supabase.rpc('disconnect_platform_connection', { target: connection.id });
  revalidatePath(`/${orgSlug}`, 'layout');
}

/** Queues a sync for one account now. The worker picks it up on its next run. */
export async function requestSync(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) return NO_PERMISSION;
  const supabase = await createClient();
  const job = field(formData, 'job');
  const { data, error } = await supabase.rpc('request_sync', {
    account_id: field(formData, 'accountId'),
    // Connected profiles sync their owner data; public profiles default to an observation.
    ...(job === 'posts_incremental' || job === 'public_profile_daily' ? { job } : {}),
  });
  if (error) return { status: 'error', message: 'Could not queue a sync for this account.' };
  revalidatePath(`/${orgSlug}/accounts/${field(formData, 'accountId')}`);
  return {
    status: 'success',
    message: data
      ? 'Queued. Scopie reads it within 15 minutes; refresh the page then.'
      : 'Could not queue a sync.',
  };
}
