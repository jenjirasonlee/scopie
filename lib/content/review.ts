import { can, type OrgRole } from '@/lib/auth/permissions';
import { CONTENT_STATUS_LABELS, isEditableStatus, type ContentStatus } from './shared';

/** What the review card offers this person right now. Pure, so the rules can be tested. */
export type ReviewOptions = {
  /** Send the current version for review. */
  submit: boolean;
  /** Changes were requested on a submitted version: a new version is needed first. */
  needsNewVersion: boolean;
  withdraw: boolean;
  /** Approve, request changes or reject. */
  decide: boolean;
  /** A manager can't decide on a version they submitted; someone else has to. */
  ownSubmission: boolean;
  schedule: boolean;
  unschedule: boolean;
  publish: boolean;
  /** Start a new version from approved, scheduled or rejected content. */
  newVersion: boolean;
  archive: boolean;
};

export function reviewOptions({
  status,
  role,
  versionSubmitted,
  submittedByMe,
}: {
  status: ContentStatus;
  role: OrgRole | null | undefined;
  /** The current version has been submitted (it stays locked after a decision). */
  versionSubmitted: boolean;
  submittedByMe: boolean;
}): ReviewOptions {
  const edit = can(role, 'content.edit');
  const approve = can(role, 'content.approve');
  const inReview = status === 'IN_REVIEW';
  const decidesOwn = role === 'OWNER' || role === 'ADMIN';
  return {
    submit: edit && isEditableStatus(status) && !versionSubmitted,
    needsNewVersion: edit && status === 'CHANGES_REQUESTED' && versionSubmitted,
    withdraw: edit && inReview,
    decide: approve && inReview && (!submittedByMe || decidesOwn),
    ownSubmission: approve && inReview && submittedByMe && !decidesOwn,
    schedule: edit && status === 'APPROVED',
    unschedule: edit && status === 'SCHEDULED',
    publish: edit && (status === 'APPROVED' || status === 'SCHEDULED'),
    newVersion: edit && (status === 'APPROVED' || status === 'SCHEDULED' || status === 'REJECTED'),
    archive: canArchive(status, role),
  };
}

/**
 * Ideas, drafts, content sent back and rejected content can be archived by editors.
 * Approved and scheduled content only by reviewers. Never while in review or once published.
 */
export function canArchive(status: ContentStatus, role: OrgRole | null | undefined) {
  if (status === 'APPROVED' || status === 'SCHEDULED') return can(role, 'content.approve');
  return can(role, 'content.edit') && (isEditableStatus(status) || status === 'REJECTED');
}

/**
 * Publish date and owner stay editable once the version is locked for review, until the
 * content is published.
 */
export function canEditPlan(status: ContentStatus) {
  return (
    status === 'IN_REVIEW' ||
    status === 'CHANGES_REQUESTED' ||
    status === 'APPROVED' ||
    status === 'SCHEDULED' ||
    status === 'REJECTED'
  );
}

type HistoryInput =
  | { kind: 'event'; from: ContentStatus | null; to: ContentStatus; note: string | null }
  | {
      kind: 'review';
      decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
      versionNumber: number;
    };

/** One line of the stage history, such as "Submitted for review" or "Approved version 2". */
export function historyTitle(entry: HistoryInput): string {
  if (entry.kind === 'review') {
    const version = `version ${entry.versionNumber}`;
    if (entry.decision === 'APPROVED') return `Approved ${version}`;
    if (entry.decision === 'REJECTED') return `Rejected ${version}`;
    return `Asked for changes to ${version}`;
  }
  const { from, to } = entry;
  if (!from) {
    if (to === 'IDEA') return 'Created as an idea';
    if (to === 'DRAFT') return 'Created as a draft';
    return CONTENT_STATUS_LABELS[to];
  }
  if (to === 'IN_REVIEW') return 'Submitted for review';
  if (from === 'IN_REVIEW' && to === 'DRAFT') return 'Taken out of review';
  if (from === 'ARCHIVED') return 'Restored as a draft';
  if (to === 'ARCHIVED') return 'Archived';
  if (to === 'SCHEDULED') return 'Marked as scheduled';
  if (from === 'SCHEDULED' && to === 'APPROVED') return 'Moved back to approved';
  if (to === 'PUBLISHED') return 'Marked as published';
  if (to === 'DRAFT' && from !== 'IDEA') return 'Back to draft';
  return `Moved to ${CONTENT_STATUS_LABELS[to].toLowerCase()}`;
}

/** Notes the database writes itself, already said by the history line. */
const REDUNDANT_NOTES = new Set(['Withdrawn from review']);

export function historyNote(note: string | null): string | null {
  const clean = note?.trim();
  return clean && !REDUNDANT_NOTES.has(clean) ? clean : null;
}

type ThreadInput = {
  id: string;
  parentId: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

/**
 * Top-level comments with their replies (one level), oldest first. Open threads come before
 * resolved ones. Replies whose parent is gone are dropped.
 */
export function threadComments<T extends ThreadInput>(
  comments: T[],
): { comment: T; replies: T[] }[] {
  const byTime = (a: T, b: T) => Date.parse(a.createdAt) - Date.parse(b.createdAt);
  const sorted = [...comments].sort(byTime);
  const threads = sorted
    .filter((c) => !c.parentId)
    .map((comment) => ({
      comment,
      replies: sorted.filter((reply) => reply.parentId === comment.id),
    }));
  return [
    ...threads.filter((t) => !t.comment.resolvedAt),
    ...threads.filter((t) => t.comment.resolvedAt),
  ];
}

/** "8 Oct 2026, 14:05" in the organization's time zone. */
export function formatDateTime(iso: string, timeZone: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}
