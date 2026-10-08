import 'server-only';
import { cache } from 'react';
import { countReviewQueue, countUnreadNotifications } from '@/lib/approvals/queries';
import { can } from '@/lib/auth/permissions';
import { getOrgContext } from '@/lib/orgs/queries';

/**
 * Counts shown in the app shell: unread notifications for the bell and, for people who can
 * review, how much content waits for review. Shared by the sidebar and the header.
 */
export const getShellCounts = cache(async (orgSlug: string) => {
  const { org, role } = await getOrgContext(orgSlug);
  const [unread, queue] = await Promise.all([
    countUnreadNotifications(org.id),
    can(role, 'content.approve') ? countReviewQueue(org.id) : null,
  ]);
  return { unread, waitingForReview: queue?.waiting ?? 0 };
});

/** Counts for the main navigation, by navigation key. */
export async function shellNavCounts(orgSlug: string) {
  const { waitingForReview } = await getShellCounts(orgSlug);
  return { approvals: { count: waitingForReview, label: 'waiting for review' } };
}
