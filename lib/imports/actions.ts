'use server';

import { revalidatePath } from 'next/cache';
import { can } from '@/lib/auth/permissions';
import { createClient } from '@/lib/db/server';
import { getOrgContext } from '@/lib/orgs/queries';
import { MAX_IMPORT_BYTES, runImport, type ImportSummary } from './run';

export type ImportState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'done'; summary: ImportSummary };

export async function importCsv(
  orgSlug: string,
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const { org, role, user } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) {
    return { status: 'error', message: 'Only owners and admins can import data.' };
  }
  const accountId = formData.get('accountId');
  const kind = formData.get('kind');
  const file = formData.get('file');
  if (typeof accountId !== 'string' || !accountId)
    return { status: 'error', message: 'Choose an account.' };
  if (kind !== 'account_metrics' && kind !== 'posts')
    return { status: 'error', message: 'Choose what the file contains.' };
  if (!(file instanceof File) || file.size === 0)
    return { status: 'error', message: 'Choose a CSV file.' };
  if (file.size > MAX_IMPORT_BYTES)
    return {
      status: 'error',
      message: 'The file is larger than 5 MB. Split it and import the parts.',
    };

  const supabase = await createClient();
  const { data: account } = await supabase
    .from('social_accounts')
    .select('id, platform_key')
    .eq('organization_id', org.id)
    .eq('id', accountId)
    .maybeSingle();
  if (!account) return { status: 'error', message: 'Account not found.' };

  const summary = await runImport(supabase, {
    organizationId: org.id,
    socialAccountId: account.id,
    platformKey: account.platform_key,
    userId: user.id,
    kind,
    fileName: file.name || 'import.csv',
    text: await file.text(),
  });
  revalidatePath(`/${orgSlug}/accounts`, 'layout');
  return { status: 'done', summary };
}
