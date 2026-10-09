'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { NotificationKind } from '@/lib/approvals/shared';
import { createClient } from '@/lib/db/server';
import { notificationHref } from '@/lib/notifications/shared';
import { getOrgContext } from '@/lib/orgs/queries';

/** Marks a notification read and opens the content it is about. */
export async function openNotification(orgSlug: string, formData: FormData): Promise<void> {
  const { org } = await getOrgContext(orgSlug);
  const id = z.uuid().safeParse(formData.get('notificationId'));
  if (!id.success) redirect(`/${orgSlug}/notifications`);
  const supabase = await createClient();
  // Row Level Security only shows people their own notifications.
  const { data, error } = await supabase
    .from('notifications')
    .select('id, kind, content_item_id, read_at')
    .eq('organization_id', org.id)
    .eq('id', id.data)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) redirect(`/${orgSlug}/notifications`);
  if (!data.read_at) {
    const { error: updateError } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', data.id);
    if (updateError) throw new Error(updateError.message);
    revalidatePath(`/${orgSlug}`, 'layout');
  }
  redirect(
    notificationHref(orgSlug, {
      kind: data.kind as NotificationKind,
      itemId: data.content_item_id,
    }) ?? `/${orgSlug}/notifications`,
  );
}
