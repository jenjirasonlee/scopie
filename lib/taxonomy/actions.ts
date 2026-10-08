'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can } from '@/lib/auth/permissions';
import { createClient } from '@/lib/db/server';
import type { TablesInsert } from '@/lib/db/types';
import { echoValues, fieldErrorsFrom, formDataToObject, type FormState } from '@/lib/forms';
import { getOrgContext } from '@/lib/orgs/queries';
import {
  isTaxonomyKind,
  TAXONOMY,
  TAXONOMY_KINDS,
  taxonomySchema,
  type TaxonomyInput,
  type TaxonomyKind,
} from './shared';

const NO_PERMISSION: FormState = {
  status: 'error',
  message: 'Only owners, admins and managers can change the content taxonomy.',
};
const NOT_FOUND: FormState = { status: 'error', message: 'This item no longer exists.' };

const idSchema = z.uuid();
const activeSchema = z.object({
  kind: z.enum(TAXONOMY_KINDS),
  id: z.uuid(),
  active: z.enum(['true', 'false']).transform((value) => value === 'true'),
});

function revalidate(orgSlug: string) {
  revalidatePath(`/${orgSlug}/settings/taxonomy`);
}

/**
 * The query builder for a kind's table. The five tables share their columns (pillars add
 * color, campaigns add dates), so they are typed as one; values() only sets a kind's own extras.
 */
async function table(kind: TaxonomyKind) {
  const supabase = await createClient();
  return supabase.from(TAXONOMY[kind].table as 'content_formats');
}

function values(kind: TaxonomyKind, input: TaxonomyInput) {
  const row: Partial<TablesInsert<'content_pillars'> & TablesInsert<'campaigns'>> = {
    name: input.name,
    description: input.description,
  };
  if (kind === 'pillars') row.color = input.color ?? null;
  if (kind === 'campaigns') {
    row.starts_on = input.startsOn ?? null;
    row.ends_on = input.endsOn ?? null;
  }
  // Typed as the shared columns for table(); the extras are only set on their own tables.
  return row as { name: string };
}

function saveError(
  kind: TaxonomyKind,
  error: { code?: string },
  raw: Record<string, string>,
): FormState {
  if (error.code === '23505') {
    return {
      status: 'error',
      fieldErrors: { name: [`There is already a ${TAXONOMY[kind].singular} with this name`] },
      values: echoValues(raw),
    };
  }
  return {
    status: 'error',
    message: 'Could not save. Please try again.',
    values: echoValues(raw),
  };
}

export async function createTaxonomyItem(
  orgSlug: string,
  kind: TaxonomyKind,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'strategy.manage')) return NO_PERMISSION;
  if (!isTaxonomyKind(kind)) return NOT_FOUND;
  const raw = formDataToObject(formData);
  const parsed = taxonomySchema(kind).safeParse(raw);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);

  const { error } = await (
    await table(kind)
  ).insert({ ...values(kind, parsed.data), organization_id: org.id });
  if (error) return saveError(kind, error, raw);

  revalidate(orgSlug);
  return { status: 'success', message: `“${parsed.data.name}” added.` };
}

export async function updateTaxonomyItem(
  orgSlug: string,
  kind: TaxonomyKind,
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'strategy.manage')) return NO_PERMISSION;
  if (!isTaxonomyKind(kind) || !idSchema.safeParse(id).success) return NOT_FOUND;
  const raw = formDataToObject(formData);
  const parsed = taxonomySchema(kind).safeParse(raw);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);

  const { data, error } = await (
    await table(kind)
  )
    .update(values(kind, parsed.data))
    .eq('organization_id', org.id)
    .eq('id', id)
    .select('id');
  if (error) return saveError(kind, error, raw);
  if (!data.length) return NOT_FOUND;

  revalidate(orgSlug);
  return { status: 'success', message: 'Changes saved.' };
}

/** Deactivates or reactivates an item. Items are never deleted: posts may still be tagged with them. */
export async function setTaxonomyItemActive(orgSlug: string, formData: FormData): Promise<void> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'strategy.manage')) throw new Error(NO_PERMISSION.message);
  const { kind, id, active } = activeSchema.parse({
    kind: formData.get('kind'),
    id: formData.get('id'),
    active: formData.get('active'),
  });

  const { data, error } = await (
    await table(kind)
  )
    .update({ is_active: active })
    .eq('organization_id', org.id)
    .eq('id', id)
    .select('id');
  if (error) throw new Error('Could not save. Please try again.');
  if (!data.length) throw new Error(NOT_FOUND.message);

  revalidate(orgSlug);
}
