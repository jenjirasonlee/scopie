'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { can } from '@/lib/auth/permissions';
import { createClient } from '@/lib/db/server';
import type { FormState } from '@/lib/forms';
import { getOrgContext } from '@/lib/orgs/queries';
import { getProfileNames, getRecommendation } from './queries';
import { runAnalysis } from './run';
import { ideaFromRecommendation, readExperiment } from './shared';

const NO_RUN_PERMISSION: FormState = {
  status: 'error',
  message: 'Only owners, admins and managers can run an analysis.',
};
const NO_EDIT_PERMISSION: FormState = {
  status: 'error',
  message: 'Only editors, managers, admins and owners can act on recommendations.',
};
const NOT_FOUND: FormState = {
  status: 'error',
  message: 'This recommendation no longer exists.',
};

function revalidate(orgSlug: string) {
  revalidatePath(`/${orgSlug}/insights`);
}

/** Runs a new analysis of the organization's data and saves its insights and recommendations. */
export async function runAnalysisAction(orgSlug: string): Promise<FormState> {
  const { org, role, user } = await getOrgContext(orgSlug);
  if (!can(role, 'strategy.manage')) return NO_RUN_PERMISSION;

  const result = await runAnalysis({
    orgId: org.id,
    orgSlug,
    isDemoOrg: org.is_demo,
    timeZone: org.default_timezone,
    userId: user.id,
  });
  if (result.status === 'error') return { status: 'error', message: result.message };

  revalidate(orgSlug);
  return { status: 'success', message: 'Analysis finished. The results below are up to date.' };
}

const statusSchema = z.object({
  recommendationId: z.uuid(),
  status: z.enum(['open', 'done', 'dismissed']),
  note: z
    .string()
    .trim()
    .max(500, 'Keep the reason under 500 characters.')
    .optional()
    .transform((value) => value || undefined),
});

/** Dismiss (with an optional reason), mark done, or reopen a recommendation. */
export async function setRecommendationStatusAction(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { role } = await getOrgContext(orgSlug);
  if (!can(role, 'content.edit')) return NO_EDIT_PERMISSION;
  const parsed = statusSchema.safeParse({
    recommendationId: formData.get('recommendationId'),
    status: formData.get('status'),
    note: formData.get('note') ?? undefined,
  });
  if (!parsed.success) {
    const message = parsed.error.issues.find((issue) => issue.path[0] === 'note')?.message;
    return message ? { status: 'error', message } : NOT_FOUND;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_recommendation_status', {
    recommendation_id: parsed.data.recommendationId,
    new_status: parsed.data.status,
    note: parsed.data.status === 'dismissed' ? parsed.data.note : undefined,
  });
  if (error) {
    if (error.code === '42501') return NOT_FOUND;
    if (error.code === '23514') return { status: 'error', message: error.message };
    return { status: 'error', message: 'Could not save. Please try again.' };
  }

  revalidate(orgSlug);
  const done: Record<typeof parsed.data.status, string> = {
    open: 'Reopened. It’s back under Open.',
    done: 'Marked done. It’s now under Done.',
    dismissed: 'Dismissed. It’s now under Dismissed.',
  };
  return { status: 'success', message: done[parsed.data.status] };
}

/**
 * Turns a recommendation into a content idea linked to it and marks it accepted. When an
 * idea was already made from it, opens that one instead of making a second.
 */
export async function createIdeaFromRecommendation(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org, role, user } = await getOrgContext(orgSlug);
  if (!can(role, 'content.edit')) return NO_EDIT_PERMISSION;
  const id = z.uuid().safeParse(formData.get('recommendationId'));
  if (!id.success) return NOT_FOUND;

  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase
    .from('content_items')
    .select('id')
    .eq('organization_id', org.id)
    .eq('source_recommendation_id', id.data)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (existingError) return { status: 'error', message: 'Could not save. Please try again.' };
  if (existing) redirect(`/${orgSlug}/content/${existing.id}`);

  const rec = await getRecommendation(org.id, id.data);
  if (!rec) return NOT_FOUND;
  const experiment = readExperiment(rec.experiment);
  const names = await getProfileNames(org.id, experiment?.accountIds ?? []);
  const idea = ideaFromRecommendation(
    {
      title: rec.title,
      observation: rec.observation,
      recommendation: rec.recommendation,
      expectedImpact: rec.expected_impact,
      experiment,
    },
    names,
  );

  // Created as the member, through the same rules as any new content item.
  const { data: item, error } = await supabase
    .from('content_items')
    .insert({
      organization_id: org.id,
      title: idea.title,
      status: 'IDEA',
      owner_user_id: user.id,
      source_recommendation_id: rec.id,
    })
    .select('id')
    .single();
  if (error) {
    return {
      status: 'error',
      message:
        error.code === '42501'
          ? 'You can’t create content here.'
          : 'Could not create the content idea. Please try again.',
    };
  }

  // The database created version 1 with the item; fill in its text.
  const { error: versionError } = await supabase
    .from('content_versions')
    .update({ description: idea.description, notes: idea.notes })
    .eq('content_item_id', item.id)
    .eq('version_number', 1);
  if (versionError) {
    return { status: 'error', message: 'The idea was created, but its text could not be saved.' };
  }

  // The idea exists either way; if this fails the recommendation simply stays open.
  await supabase.rpc('set_recommendation_status', {
    recommendation_id: rec.id,
    new_status: 'accepted',
    note: 'Content idea created',
  });

  revalidate(orgSlug);
  revalidatePath(`/${orgSlug}/content`);
  revalidatePath(`/${orgSlug}/calendar`);
  redirect(`/${orgSlug}/content/${item.id}?created=1`);
}
