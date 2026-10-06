'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { can } from '@/lib/auth/permissions';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/db/server';
import { echoValues, fieldErrorsFrom, formDataToObject, type FormState } from '@/lib/forms';
import { getOrgContext } from '@/lib/orgs/queries';
import { organizationSchema, organizationSettingsSchema } from '@/schemas/organization';

export async function createOrganization(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  const raw = formDataToObject(formData);
  const parsed = organizationSchema.safeParse(raw);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_organization', {
    org_name: parsed.data.name,
    org_slug: parsed.data.slug,
    org_timezone: parsed.data.defaultTimezone,
  });

  if (error) {
    if (error.code === '23505') {
      return {
        status: 'error',
        fieldErrors: { slug: ['This URL is already taken'] },
        values: echoValues(raw),
      };
    }
    return {
      status: 'error',
      message: 'Could not create the organization. Please try again.',
      values: echoValues(raw),
    };
  }

  redirect(`/${data.slug}/dashboard`);
}

export async function updateOrganization(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'org.update')) {
    return { status: 'error', message: 'Only owners and admins can change organization settings.' };
  }
  const raw = formDataToObject(formData);
  const parsed = organizationSettingsSchema.safeParse(raw);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);

  const supabase = await createClient();
  const { error } = await supabase
    .from('organizations')
    .update({ name: parsed.data.name, default_timezone: parsed.data.defaultTimezone })
    .eq('id', org.id);
  if (error) return { status: 'error', message: 'Could not save changes.' };

  revalidatePath(`/${orgSlug}`, 'layout');
  return { status: 'success', message: 'Organization settings saved.' };
}
