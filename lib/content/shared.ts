import type { Enums } from '@/lib/db/types';

export type ContentStatus = Enums<'content_status'>;

export const CONTENT_STATUS_LABELS: Record<ContentStatus, string> = {
  IDEA: 'Idea',
  DRAFT: 'Draft',
  IN_REVIEW: 'In review',
  CHANGES_REQUESTED: 'Changes requested',
  APPROVED: 'Approved',
  SCHEDULED: 'Scheduled',
  PUBLISHED: 'Published',
  ANALYSED: 'Analysed',
  REJECTED: 'Rejected',
  ARCHIVED: 'Archived',
};

export const CONTENT_STATUS_VARIANT: Record<
  ContentStatus,
  'secondary' | 'outline' | 'muted' | 'success' | 'warning' | 'destructive'
> = {
  IDEA: 'outline',
  DRAFT: 'secondary',
  IN_REVIEW: 'warning',
  CHANGES_REQUESTED: 'warning',
  APPROVED: 'success',
  SCHEDULED: 'success',
  PUBLISHED: 'success',
  ANALYSED: 'success',
  REJECTED: 'destructive',
  ARCHIVED: 'muted',
};

/** Statuses shown in filters, in workflow order. */
export const CONTENT_STATUSES = Object.keys(CONTENT_STATUS_LABELS) as ContentStatus[];

/** What a status means, for help text. */
export const CONTENT_STATUS_HELP: Record<ContentStatus, string> = {
  IDEA: 'A rough idea, not being written yet.',
  DRAFT: 'Being written and designed.',
  IN_REVIEW: 'Submitted and waiting for a manager, admin or owner to review it. Locked meanwhile.',
  CHANGES_REQUESTED: 'A reviewer asked for changes. Start a new version, make them and submit again.',
  APPROVED: 'Approved. Starting a new version sends it back to draft.',
  SCHEDULED: 'Approved and queued in the publishing tool.',
  PUBLISHED: 'Live on the platform.',
  ANALYSED: 'Published and its results reviewed.',
  REJECTED: 'Not going ahead. It can be reworked as a new version or archived.',
  ARCHIVED: 'Put away. It keeps its history and can be restored as a draft.',
};

/** Stages whose current version can be edited (when it hasn't been submitted). */
export function isEditableStatus(status: ContentStatus) {
  return status === 'IDEA' || status === 'DRAFT' || status === 'CHANGES_REQUESTED';
}

/** Stages people can switch between in the content form. */
export function isFormStatus(status: ContentStatus) {
  return status === 'IDEA' || status === 'DRAFT';
}

export type ContentFilters = {
  q?: string;
  status?: ContentStatus;
  platform?: string;
  country?: string;
  pillar?: string;
  campaign?: string;
  owner?: string;
  /** Archived items are hidden unless asked for. */
  archived: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function single(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

export function parseContentFilters(
  search: Record<string, string | string[] | undefined>,
): ContentFilters {
  const status = single(search.status);
  const country = single(search.country)?.toUpperCase();
  const uuid = (key: string) => {
    const value = single(search[key]);
    return value && UUID.test(value) ? value : undefined;
  };
  return {
    q: single(search.q)?.slice(0, 100),
    status: status && status in CONTENT_STATUS_LABELS ? (status as ContentStatus) : undefined,
    platform: single(search.platform)?.slice(0, 40),
    country: country && /^[A-Z]{2}$/.test(country) ? country : undefined,
    pillar: uuid('pillar'),
    campaign: uuid('campaign'),
    owner: uuid('owner'),
    archived: single(search.archived) === '1' || status === 'ARCHIVED',
  };
}
