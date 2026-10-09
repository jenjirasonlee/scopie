import type { QueueTab } from '@/lib/approvals/shared';
import type { OrgRole } from '@/lib/auth/permissions';

export const QUEUE_TAB_LABELS: Record<QueueTab, string> = {
  waiting: 'Waiting for review',
  changes: 'Changes requested',
  approved: 'Approved',
  decided: 'Published or rejected',
};

/** What each tab holds, shown when it's empty. */
export const QUEUE_TAB_EMPTY: Record<QueueTab, { title: string; body: string }> = {
  waiting: {
    title: 'Nothing is waiting for review',
    body: 'When someone submits content for review, it shows up here until a manager, admin or owner approves it, asks for changes or rejects it.',
  },
  changes: {
    title: 'No content needs changes',
    body: 'Content a reviewer sent back shows up here. The author starts a new version, makes the changes and submits it again.',
  },
  approved: {
    title: 'No approved content yet',
    body: 'Approved content shows up here until it’s published, including content already scheduled in your publishing tool.',
  },
  decided: {
    title: 'Nothing published or rejected yet',
    body: 'Published and rejected content shows up here, most recent first, so you can look back at what was decided.',
  },
};

/**
 * Managers can't review a version they submitted themselves; admins and owners can.
 * The database enforces this; the queue only points it out.
 */
export function needsAnotherReviewer(
  role: OrgRole,
  currentUserId: string,
  submittedById: string | null,
): boolean {
  return role === 'MANAGER' && submittedById !== null && submittedById === currentUserId;
}
