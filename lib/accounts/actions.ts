'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { can } from '@/lib/auth/permissions';
import { createClient } from '@/lib/db/server';
import { echoValues, fieldErrorsFrom, formDataToObject, type FormState } from '@/lib/forms';
import { getOrgContext } from '@/lib/orgs/queries';
import { socialAccountSchema, toSocialAccountRow } from '@/schemas/social-account';

const NO_PERMISSION: FormState = {
  status: 'error',
  message: 'Only owners and admins can manage social accounts.',
};

function describeDbError(error: { code?: string; message: string }): FormState {
  if (error.code === '23505') {
    return {
      status: 'error',
      fieldErrors: { handle: ['This organization already has this account on this platform'] },
    };
  }
  if (error.message.includes('owner must be a member')) {
    return {
      status: 'error',
      fieldErrors: { ownerUserId: ['Choose a member of this organization'] },
    };
  }
  if (error.code === '23503') {
    return { status: 'error', message: 'Unknown platform or country.' };
  }
  return { status: 'error', message: 'Could not save the account. Please try again.' };
}

export async function createSocialAccount(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) return NO_PERMISSION;

  const raw = formDataToObject(formData);
  const parsed = socialAccountSchema.safeParse(raw);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);

  const supabase = await createClient();
  const { error } = await supabase
    .from('social_accounts')
    .insert({ ...toSocialAccountRow(parsed.data), organization_id: org.id });
  if (error) return { ...describeDbError(error), values: echoValues(raw) };

  revalidatePath(`/${orgSlug}/accounts`);
  redirect(`/${orgSlug}/accounts?created=1`);
}

export async function updateSocialAccount(
  orgSlug: string,
  accountId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) return NO_PERMISSION;

  const raw = formDataToObject(formData);
  const parsed = socialAccountSchema.safeParse(raw);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('social_accounts')
    .update(toSocialAccountRow(parsed.data))
    .eq('organization_id', org.id)
    .eq('id', accountId)
    .select('id');
  if (error) return { ...describeDbError(error), values: echoValues(raw) };
  if (!data.length) return { status: 'error', message: 'Account not found.' };

  revalidatePath(`/${orgSlug}/accounts`);
  return { status: 'success', message: 'Account saved.' };
}

const setActiveSchema = z.object({ accountId: z.uuid(), active: z.enum(['true', 'false']) });

export async function setSocialAccountActive(orgSlug: string, formData: FormData): Promise<void> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) throw new Error(NO_PERMISSION.message);

  const parsed = setActiveSchema.parse({
    accountId: formData.get('accountId'),
    active: formData.get('active'),
  });

  const supabase = await createClient();
  const { error } = await supabase
    .from('social_accounts')
    .update({ is_active: parsed.active === 'true' })
    .eq('organization_id', org.id)
    .eq('id', parsed.accountId);
  if (error) throw new Error('Could not update the account.');

  revalidatePath(`/${orgSlug}/accounts`);
}
