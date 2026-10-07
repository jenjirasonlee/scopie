'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can } from '@/lib/auth/permissions';
import { createClient } from '@/lib/db/server';
import { echoValues, fieldErrorsFrom, formDataToObject, type FormState } from '@/lib/forms';
import { getOrgContext } from '@/lib/orgs/queries';

const NO_PERMISSION: FormState = {
  status: 'error',
  message: 'Only owners and admins can change benchmark groups.',
};

const nameSchema = z.object({
  name: z.string().trim().min(1, 'Give the group a name').max(80, 'Use at most 80 characters'),
});
const groupIdSchema = z.object({ groupId: z.uuid() });
const membersSchema = z.object({
  groupId: z.uuid(),
  accountIds: z.array(z.uuid()).min(1, 'Choose at least one profile'),
});
const memberSchema = z.object({ groupId: z.uuid(), accountId: z.uuid() });

function revalidate(orgSlug: string) {
  revalidatePath(`/${orgSlug}/benchmarks`);
  revalidatePath(`/${orgSlug}/benchmarks/groups`);
}

function nameError(error: { code?: string }, raw: Record<string, string>): FormState {
  if (error.code === '23505') {
    return {
      status: 'error',
      fieldErrors: { name: ['A group with this name already exists'] },
      values: echoValues(raw),
    };
  }
  return {
    status: 'error',
    message: 'Could not save the group. Please try again.',
    values: echoValues(raw),
  };
}

export async function createBenchmarkGroup(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) return NO_PERMISSION;
  const raw = formDataToObject(formData);
  const parsed = nameSchema.safeParse(raw);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);

  const supabase = await createClient();
  const { error } = await supabase
    .from('account_groups')
    .insert({ organization_id: org.id, name: parsed.data.name, kind: 'custom' });
  if (error) return nameError(error, raw);

  revalidate(orgSlug);
  return { status: 'success', message: `Group “${parsed.data.name}” created.` };
}

export async function renameBenchmarkGroup(
  orgSlug: string,
  groupId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) return NO_PERMISSION;
  const raw = formDataToObject(formData);
  const parsed = nameSchema.safeParse(raw);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);
  if (!groupIdSchema.safeParse({ groupId }).success) {
    return { status: 'error', message: 'Group not found.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('account_groups')
    .update({ name: parsed.data.name })
    .eq('organization_id', org.id)
    .eq('kind', 'custom')
    .eq('id', groupId)
    .select('id');
  if (error) return nameError(error, raw);
  if (!data.length) return { status: 'error', message: 'Group not found.' };

  revalidate(orgSlug);
  return { status: 'success', message: 'Group renamed.' };
}

export async function deleteBenchmarkGroup(orgSlug: string, formData: FormData): Promise<void> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) throw new Error(NO_PERMISSION.message);
  const { groupId } = groupIdSchema.parse({ groupId: formData.get('groupId') });

  const supabase = await createClient();
  const { error } = await supabase
    .from('account_groups')
    .delete()
    .eq('organization_id', org.id)
    .eq('kind', 'custom')
    .eq('id', groupId);
  if (error) throw new Error('Could not delete the group.');

  revalidate(orgSlug);
}

export async function addBenchmarkGroupMembers(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) return NO_PERMISSION;
  const parsed = membersSchema.safeParse({
    groupId: formData.get('groupId'),
    accountIds: formData.getAll('accountId'),
  });
  if (!parsed.success) return fieldErrorsFrom(parsed.error);

  const supabase = await createClient();
  const group = await supabase
    .from('account_groups')
    .select('id')
    .eq('organization_id', org.id)
    .eq('kind', 'custom')
    .eq('id', parsed.data.groupId)
    .maybeSingle();
  if (group.error || !group.data) return { status: 'error', message: 'Group not found.' };

  const { error } = await supabase.from('account_group_members').upsert(
    parsed.data.accountIds.map((accountId) => ({
      group_id: parsed.data.groupId,
      social_account_id: accountId,
      organization_id: org.id,
    })),
    { onConflict: 'group_id,social_account_id', ignoreDuplicates: true },
  );
  if (error) {
    return { status: 'error', message: 'Could not add the profiles. Please try again.' };
  }

  revalidate(orgSlug);
  const count = parsed.data.accountIds.length;
  return { status: 'success', message: `${count} profile${count === 1 ? '' : 's'} added.` };
}

export async function removeBenchmarkGroupMember(
  orgSlug: string,
  formData: FormData,
): Promise<void> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'accounts.manage')) throw new Error(NO_PERMISSION.message);
  const { groupId, accountId } = memberSchema.parse({
    groupId: formData.get('groupId'),
    accountId: formData.get('accountId'),
  });

  const supabase = await createClient();
  const group = await supabase
    .from('account_groups')
    .select('id')
    .eq('organization_id', org.id)
    .eq('kind', 'custom')
    .eq('id', groupId)
    .maybeSingle();
  if (group.error || !group.data) throw new Error('Group not found.');
  const { error } = await supabase
    .from('account_group_members')
    .delete()
    .eq('organization_id', org.id)
    .eq('group_id', groupId)
    .eq('social_account_id', accountId);
  if (error) throw new Error('Could not remove the profile.');

  revalidate(orgSlug);
}
