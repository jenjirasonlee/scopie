'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can } from '@/lib/auth/permissions';
import { createClient } from '@/lib/db/server';
import type { FormState } from '@/lib/forms';
import { getOrgContext } from '@/lib/orgs/queries';
import { canReschedule, parseDateKey, rescheduledAt } from './dates';
import { safeTimeZone } from './time';

export type RescheduleResult = { ok: true } | { ok: false; message: string };

const itemIdSchema = z.guid();

/**
 * Moves a content item to another day (`isoDate`, "YYYY-MM-DD" in the organization's time
 * zone), keeping its local time of day. Published and archived items keep their date.
 */
export async function rescheduleContentItem(
  orgSlug: string,
  itemId: string,
  isoDate: string,
): Promise<RescheduleResult> {
  const { org, role } = await getOrgContext(orgSlug);
  if (!can(role, 'content.edit')) {
    return { ok: false, message: 'Only editors and above can move content.' };
  }
  const day = parseDateKey(isoDate);
  if (!day) return { ok: false, message: 'Choose a valid date.' };
  if (!itemIdSchema.safeParse(itemId).success) return { ok: false, message: 'Content not found.' };

  const supabase = await createClient();
  const { data: item, error } = await supabase
    .from('content_items')
    .select('id, status, planned_publish_at, published_at')
    .eq('organization_id', org.id)
    .eq('id', itemId)
    .maybeSingle();
  if (error) return { ok: false, message: 'Could not move the content. Please try again.' };
  if (!item) return { ok: false, message: 'Content not found.' };
  if (!canReschedule({ status: item.status, publishedAt: item.published_at })) {
    return {
      ok: false,
      message:
        item.status === 'ARCHIVED'
          ? 'Archived content can’t be moved. Restore it first.'
          : 'Published content keeps its publish date.',
    };
  }

  const at = rescheduledAt(day, item.planned_publish_at, safeTimeZone(org.default_timezone));
  const { data, error: updateError } = await supabase
    .from('content_items')
    .update({ planned_publish_at: at.toISOString() })
    .eq('organization_id', org.id)
    .eq('id', itemId)
    .select('id');
  if (updateError || !data.length) {
    return { ok: false, message: 'Could not move the content. Please try again.' };
  }

  revalidatePath(`/${orgSlug}/calendar`);
  revalidatePath(`/${orgSlug}/content`);
  revalidatePath(`/${orgSlug}/content/${itemId}`);
  return { ok: true };
}

/** The side panel's date form: the same move, for useActionState (works without JavaScript). */
export async function rescheduleContentItemForm(
  orgSlug: string,
  itemId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const date = formData.get('date');
  const result = await rescheduleContentItem(orgSlug, itemId, typeof date === 'string' ? date : '');
  return result.ok
    ? { status: 'success', message: 'Date changed.' }
    : { status: 'error', message: result.message, values: { date: String(date ?? '') } };
}
