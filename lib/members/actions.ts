'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assignableRoles, can, ORG_ROLES } from '@/lib/auth/permissions';
import { createClient } from '@/lib/db/server';
import type { FormState } from '@/lib/forms';
import { getOrgContext } from '@/lib/orgs/queries';

const changeRoleSchema = z.object({
  userId: z.uuid(),
  role: z.enum(ORG_ROLES),
});

export async function changeMemberRole(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, role: actorRole } = await getOrgContext(orgSlug);
  const parsed = changeRoleSchema.safeParse({
    userId: formData.get('userId'),
    role: formData.get('role'),
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid role change.' };
  if (!can(actorRole, 'members.manage') || !assignableRoles(actorRole).includes(parsed.data.role)) {
    return { status: 'error', message: 'You do not have permission to assign this role.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('organization_members')
    .update({ role: parsed.data.role })
    .eq('organization_id', org.id)
    .eq('user_id', parsed.data.userId)
    .select('user_id');

  if (error) {
    const message = error.message.includes('at least one owner')
      ? 'An organization must keep at least one owner.'
      : 'Could not change the role.';
    return { status: 'error', message };
  }
  if (!data.length) {
    return { status: 'error', message: 'You do not have permission to change this member.' };
  }

  revalidatePath(`/${orgSlug}/settings/members`);
  return { status: 'success', message: 'Role updated.' };
}
