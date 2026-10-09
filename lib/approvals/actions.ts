'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can, type Permission } from '@/lib/auth/permissions';
import { createClient } from '@/lib/db/server';
import { formDataToObject, type FormState } from '@/lib/forms';
import { getOrgContext } from '@/lib/orgs/queries';
import { parseMentions } from './shared';

const NOT_ALLOWED: Record<'content.edit' | 'content.approve', string> = {
  'content.edit': 'Only editors, managers, admins and owners can do this.',
  'content.approve': 'Only managers, admins and owners can review content.',
};

/** Database rule messages are written for people; anything else gets a generic message. */
function errorState(error: { code?: string; message: string }): FormState {
  const known = error.code === '42501' || error.code === '23514' || error.code === 'P0001';
  return {
    status: 'error',
    message:
      known && !error.message.startsWith('new row')
        ? error.message
        : 'Could not save. Please try again.',
  };
}

async function guard(orgSlug: string, permission: Permission) {
  const context = await getOrgContext(orgSlug);
  if (!can(context.role, permission)) return null;
  return context;
}

function revalidate(orgSlug: string, itemId: string) {
  revalidatePath(`/${orgSlug}/content`);
  revalidatePath(`/${orgSlug}/content/${itemId}`);
  revalidatePath(`/${orgSlug}/calendar`);
  revalidatePath(`/${orgSlug}/approvals`);
  revalidatePath(`/${orgSlug}/notifications`);
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters.`)
    .transform((value) => value || null);

const submitSchema = z.object({ itemId: z.uuid(), note: text(1000).optional() });

export async function submitForReview(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await guard(orgSlug, 'content.edit')))
    return { status: 'error', message: NOT_ALLOWED['content.edit'] };
  const parsed = submitSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { status: 'error', message: 'Content not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_content_for_review', {
    item_id: parsed.data.itemId,
    note: parsed.data.note ?? undefined,
  });
  if (error) return errorState(error);
  revalidate(orgSlug, parsed.data.itemId);
  return { status: 'success', message: 'Submitted for review. Reviewers have been notified.' };
}

const itemSchema = z.object({ itemId: z.uuid() });

export async function withdrawFromReview(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await guard(orgSlug, 'content.edit')))
    return { status: 'error', message: NOT_ALLOWED['content.edit'] };
  const parsed = itemSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { status: 'error', message: 'Content not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('withdraw_content_from_review', {
    item_id: parsed.data.itemId,
  });
  if (error) return errorState(error);
  revalidate(orgSlug, parsed.data.itemId);
  return { status: 'success', message: 'Taken out of review. It’s a draft again.' };
}

const reviewSchema = z
  .object({
    itemId: z.uuid(),
    decision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REJECTED']),
    comment: text(5000).optional(),
  })
  .refine((v) => v.decision === 'APPROVED' || Boolean(v.comment), {
    path: ['comment'],
    message: 'Say what needs to change, or why it’s rejected.',
  });

const DECIDED: Record<z.infer<typeof reviewSchema>['decision'], string> = {
  APPROVED: 'Approved.',
  CHANGES_REQUESTED: 'Changes requested. The author has been notified.',
  REJECTED: 'Rejected. The author has been notified.',
};

export async function reviewContent(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await guard(orgSlug, 'content.approve')))
    return { status: 'error', message: NOT_ALLOWED['content.approve'] };
  const raw = formDataToObject(formData);
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) {
    const comment = parsed.error.issues.find((issue) => issue.path[0] === 'comment');
    return {
      status: 'error',
      message: comment?.message ?? 'Choose a decision.',
      fieldErrors: comment ? { comment: [comment.message] } : undefined,
      values: raw,
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('review_content', {
    item_id: parsed.data.itemId,
    decision: parsed.data.decision,
    comment: parsed.data.comment ?? undefined,
  });
  if (error) return { ...errorState(error), values: raw };
  revalidate(orgSlug, parsed.data.itemId);
  return { status: 'success', message: DECIDED[parsed.data.decision] };
}

const scheduleSchema = z.object({ itemId: z.uuid(), scheduled: z.enum(['true', 'false']) });

export async function setScheduled(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await guard(orgSlug, 'content.edit')))
    return { status: 'error', message: NOT_ALLOWED['content.edit'] };
  const parsed = scheduleSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { status: 'error', message: 'Content not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_content_scheduled', {
    item_id: parsed.data.itemId,
    scheduled: parsed.data.scheduled === 'true',
  });
  if (error) return errorState(error);
  revalidate(orgSlug, parsed.data.itemId);
  return {
    status: 'success',
    message: parsed.data.scheduled === 'true' ? 'Marked as scheduled.' : 'Back to approved.',
  };
}

const publishSchema = z.object({
  itemId: z.uuid(),
  postId: z
    .union([z.uuid(), z.literal('')])
    .optional()
    .transform((v) => v || null),
});

/** Marks content as published now, or at the linked post's publish time. */
export async function markPublished(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await guard(orgSlug, 'content.edit')))
    return { status: 'error', message: NOT_ALLOWED['content.edit'] };
  const parsed = publishSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { status: 'error', message: 'Content not found.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_content_published', {
    item_id: parsed.data.itemId,
    post_id: parsed.data.postId ?? undefined,
  });
  if (error) return errorState(error);
  revalidate(orgSlug, parsed.data.itemId);
  return { status: 'success', message: 'Marked as published.' };
}

const commentSchema = z.object({
  itemId: z.uuid(),
  parentId: z
    .union([z.uuid(), z.literal('')])
    .optional()
    .transform((v) => v || null),
  body: z
    .string()
    .trim()
    .min(1, 'Write a comment first.')
    .max(5000, 'Keep comments under 5,000 characters.'),
});

export async function addComment(
  orgSlug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = await guard(orgSlug, 'content.edit');
  if (!context) return { status: 'error', message: NOT_ALLOWED['content.edit'] };
  const raw = formDataToObject(formData);
  const parsed = commentSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Write a comment first.';
    return { status: 'error', message, fieldErrors: { body: [message] }, values: raw };
  }
  const supabase = await createClient();
  const { error } = await supabase.from('content_comments').insert({
    organization_id: context.org.id,
    content_item_id: parsed.data.itemId,
    parent_id: parsed.data.parentId,
    body: parsed.data.body,
    mentions: parseMentions(formData.getAll('mentions')),
  });
  if (error) return { ...errorState(error), values: raw };
  revalidate(orgSlug, parsed.data.itemId);
  return { status: 'success', message: 'Comment added.' };
}

const commentIdSchema = z.object({ itemId: z.uuid(), commentId: z.uuid() });

export async function setCommentResolved(orgSlug: string, formData: FormData): Promise<void> {
  const context = await guard(orgSlug, 'content.edit');
  if (!context) throw new Error(NOT_ALLOWED['content.edit']);
  const { itemId, commentId } = commentIdSchema.parse(formDataToObject(formData));
  const resolved = formData.get('resolved') === 'true';
  const supabase = await createClient();
  const { error } = await supabase
    .from('content_comments')
    .update({ resolved_at: resolved ? new Date().toISOString() : null })
    .eq('organization_id', context.org.id)
    .eq('id', commentId);
  if (error) throw new Error(error.message);
  revalidate(orgSlug, itemId);
}

export async function deleteComment(orgSlug: string, formData: FormData): Promise<void> {
  const context = await guard(orgSlug, 'content.edit');
  if (!context) throw new Error(NOT_ALLOWED['content.edit']);
  const { itemId, commentId } = commentIdSchema.parse(formDataToObject(formData));
  const supabase = await createClient();
  const { error } = await supabase
    .from('content_comments')
    .delete()
    .eq('organization_id', context.org.id)
    .eq('id', commentId);
  if (error) throw new Error(error.message);
  revalidate(orgSlug, itemId);
}

/** Marks one notification read, or all of them when no id is given. */
export async function markNotificationsRead(orgSlug: string, formData: FormData): Promise<void> {
  const { org } = await getOrgContext(orgSlug);
  const id = formData.get('notificationId');
  const supabase = await createClient();
  let query = supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('organization_id', org.id)
    .is('read_at', null);
  if (typeof id === 'string' && z.uuid().safeParse(id).success) query = query.eq('id', id);
  const { error } = await query;
  if (error) throw new Error(error.message);
  revalidatePath(`/${orgSlug}`, 'layout');
}
