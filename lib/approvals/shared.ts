import type { Enums } from '@/lib/db/types';

export type ReviewDecision = Enums<'review_decision'>;

export const DECISION_LABELS: Record<ReviewDecision, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  REJECTED: 'Rejected',
};

export type NotificationKind =
  | 'review_requested'
  | 'approved'
  | 'changes_requested'
  | 'rejected'
  | 'mentioned'
  | 'commented'
  | 'report_ready';

/**
 * "Sam asked you to review", followed by the content title. A new report reads as a whole
 * sentence instead (reportReadyText in lib/reports/shared.ts).
 */
export const NOTIFICATION_TEXT: Record<NotificationKind, string> = {
  review_requested: 'asked for a review of',
  approved: 'approved',
  changes_requested: 'asked for changes to',
  rejected: 'rejected',
  mentioned: 'mentioned you on',
  commented: 'commented on',
  report_ready: 'made',
};

/** The review queue's tabs. */
export const QUEUE_TABS = ['waiting', 'changes', 'approved', 'decided'] as const;
export type QueueTab = (typeof QUEUE_TABS)[number];

export function parseQueueTab(value: unknown): QueueTab {
  return QUEUE_TABS.includes(value as QueueTab) ? (value as QueueTab) : 'waiting';
}

/** Mentions are chosen from a list, not typed, so they always point at a real member. */
export function parseMentions(values: unknown[]): string[] {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return [
    ...new Set(values.filter((v): v is string => typeof v === 'string' && uuid.test(v))),
  ].slice(0, 20);
}
