'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { can } from '@/lib/auth/permissions';
import { zonedDateTimeToUtc } from '@/lib/calendar/time';
import { createClient } from '@/lib/db/server';
import { echoValues, fieldErrorsFrom, formDataToObject, type FormState } from '@/lib/forms';
import { getOrgContext } from '@/lib/orgs/queries';
import { contentItemSchema, contentPlanSchema, type ContentItemInput } from '@/schemas/content';
import { isFormStatus } from './shared';
import { assetStore } from './store';

const NO_PERMISSION: FormState = {
  status: 'error',
  message: 'Only editors, managers, admins and owners can change content.',
};

/** Default publishing time when only a date is chosen, in the organization's time zone. */
const DEFAULT_TIME = '09:00';

function parseForm(formData: FormData) {
  const platformKeys = formData
    .getAll('platformKeys')
    .filter((v): v is string => typeof v === 'string');
  // Echoed back as one value so the checkboxes keep their state after a failed submit.
  const raw = { ...formDataToObject(formData), platformKeys: platformKeys.join(',') };
  const parsed = contentItemSchema.safeParse({ ...raw, platformKeys });
  return { raw, parsed };
}

function plannedAt(input: { plannedDate: string; plannedTime: string }, timeZone: string) {
  return input.plannedDate
    ? zonedDateTimeToUtc(
        input.plannedDate,
        input.plannedTime || DEFAULT_TIME,
        timeZone,
      ).toISOString()
    : null;
}

function itemFields(input: ContentItemInput, timeZone: string) {
  return {
    title: input.title,
    status: input.status,
    platform_keys: input.platformKeys,
    country_code: input.countryCode,
    owner_user_id: input.ownerUserId,
    pillar_id: input.pillarId,
    content_format_id: input.contentFormatId,
    campaign_id: input.campaignId,
    audience_id: input.audienceId,
    cta_type_id: input.ctaTypeId,
    strategy_objective_id: input.strategyObjectiveId,
    planned_publish_at: plannedAt(input, timeZone),
  };
}

function versionFields(input: ContentItemInput) {
  return {
    description: input.description,
    caption: input.caption,
    cta: input.cta,
    hashtags: input.hashtags,
    notes: input.notes,
  };
}

/** Postgres errors raised by the content rules, in words people understand. */
function saveError(
  error: { code?: string; message: string },
  raw: Record<string, string>,
): FormState {
  const known =
    error.code === '42501' || error.code === '23514'
      ? error.message.replace(/^new row .*$/, 'You can’t make this change.')
      : null;
  return {
    status: 'error',
    message: known ?? 'Could not save. Please try again.',
    values: echoValues(raw),
  };
}

function revalidate(orgSlug: string, itemId?: string) {
  revalidatePath(`/${orgSlug}/content`);
  revalidatePath(`/${orgSlug}/calendar`);
  revalidatePath(`/${orgSlug}/approvals`);
  if (itemId) revalidatePath(`/${orgSlug}/content/${itemId}`);
}

export async function createContentItem(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'content.edit')) return NO_PERMISSION;
  const { raw, parsed } = parseForm(formData);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);

  const supabase = await createClient();
  const { data: item, error } = await supabase
    .from('content_items')
    .insert({ organization_id: org.id, ...itemFields(parsed.data, org.default_timezone) })
    .select('id')
    .single();
  if (error) return saveError(error, raw);

  // The database created version 1 with the item; fill in its text.
  const { error: versionError } = await supabase
    .from('content_versions')
    .update(versionFields(parsed.data))
    .eq('content_item_id', item.id)
    .eq('version_number', 1);
  if (versionError) return saveError(versionError, raw);

  revalidate(orgSlug);
  redirect(`/${orgSlug}/content/${item.id}?created=1`);
}

export async function updateContentItem(
  orgSlug: string,
  itemId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'content.edit')) return NO_PERMISSION;
  if (!z.uuid().safeParse(itemId).success)
    return { status: 'error', message: 'Content not found.' };
  const { raw, parsed } = parseForm(formData);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);

  const supabase = await createClient();
  const { data: current } = await supabase
    .from('content_items')
    .select('status')
    .eq('organization_id', org.id)
    .eq('id', itemId)
    .maybeSingle();
  if (!current) return { status: 'error', message: 'Content not found.' };
  // The stage only changes here between idea and draft; review moves have their own buttons.
  const { status, ...fields } = itemFields(parsed.data, org.default_timezone);
  const { data: item, error } = await supabase
    .from('content_items')
    .update(isFormStatus(current.status) ? { ...fields, status } : fields)
    .eq('organization_id', org.id)
    .eq('id', itemId)
    .select('current_version_id')
    .maybeSingle();
  if (error) return saveError(error, raw);
  if (!item) return { status: 'error', message: 'Content not found.' };

  const { error: versionError } = await supabase
    .from('content_versions')
    .update(versionFields(parsed.data))
    .eq('id', item.current_version_id!);
  if (versionError) return saveError(versionError, raw);

  revalidate(orgSlug, itemId);
  return { status: 'success', message: 'Saved.' };
}

/**
 * Changes only the publish date and owner. Used once the version is locked for review,
 * when the rest of the content can't change.
 */
export async function updateContentPlan(
  orgSlug: string,
  itemId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'content.edit')) return NO_PERMISSION;
  if (!z.uuid().safeParse(itemId).success)
    return { status: 'error', message: 'Content not found.' };
  const raw = formDataToObject(formData);
  const parsed = contentPlanSchema.safeParse(raw);
  if (!parsed.success) return fieldErrorsFrom(parsed.error, raw);

  const supabase = await createClient();
  const { data: item, error } = await supabase
    .from('content_items')
    .update({
      owner_user_id: parsed.data.ownerUserId,
      planned_publish_at: plannedAt(parsed.data, org.default_timezone),
    })
    .eq('organization_id', org.id)
    .eq('id', itemId)
    .select('id')
    .maybeSingle();
  if (error) return saveError(error, raw);
  if (!item) return { status: 'error', message: 'Content not found.' };

  revalidate(orgSlug, itemId);
  return { status: 'success', message: 'Saved.' };
}

const itemIdSchema = z.object({ itemId: z.uuid() });

/** Keeps the current version as it is and continues editing in a new one. */
export async function startNewVersion(orgSlug: string, formData: FormData): Promise<void> {
  const { role } = await getOrgContext(orgSlug);
  if (!can(role, 'content.edit')) throw new Error(NO_PERMISSION.message);
  const { itemId } = itemIdSchema.parse({ itemId: formData.get('itemId') });
  const supabase = await createClient();
  const { error } = await supabase.rpc('create_content_version', { item_id: itemId });
  if (error) throw new Error(error.message);
  revalidate(orgSlug, itemId);
  redirect(`/${orgSlug}/content/${itemId}?versioned=1`);
}

const statusSchema = z.object({ itemId: z.uuid(), status: z.enum(['ARCHIVED', 'DRAFT']) });

/** Archive an item, or restore an archived one as a draft. */
export async function setContentArchived(orgSlug: string, formData: FormData): Promise<void> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'content.edit')) throw new Error(NO_PERMISSION.message);
  const { itemId, status } = statusSchema.parse({
    itemId: formData.get('itemId'),
    status: formData.get('status'),
  });
  const supabase = await createClient();
  const { error } = await supabase
    .from('content_items')
    .update({ status })
    .eq('organization_id', org.id)
    .eq('id', itemId);
  if (error) throw new Error(error.message);
  revalidate(orgSlug, itemId);
}

const assetSchema = z.object({ itemId: z.uuid(), assetId: z.uuid() });

/** Removes a file from the current version. The file itself is deleted once no version uses it. */
export async function removeContentAsset(orgSlug: string, formData: FormData): Promise<void> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'content.edit')) throw new Error(NO_PERMISSION.message);
  const { itemId, assetId } = assetSchema.parse({
    itemId: formData.get('itemId'),
    assetId: formData.get('assetId'),
  });
  const supabase = await createClient();
  const { data: removed, error } = await supabase
    .from('content_assets')
    .delete()
    .eq('organization_id', org.id)
    .eq('content_item_id', itemId)
    .eq('id', assetId)
    .select('storage_path')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (removed) {
    const { count } = await supabase
      .from('content_assets')
      .select('id', { count: 'exact', head: true })
      .eq('storage_path', removed.storage_path);
    if (count === 0) await assetStore()?.remove([removed.storage_path]);
  }
  revalidate(orgSlug, itemId);
}
