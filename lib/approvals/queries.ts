import 'server-only';
import { createClient } from '@/lib/db/server';
import type { ContentStatus } from '@/lib/content/shared';
import type { NotificationKind, QueueTab, ReviewDecision } from './shared';

type Person = { full_name: string | null; email: string } | null;
const nameOf = (person: Person) => (person ? (person.full_name ?? person.email) : null);

export type ReviewHistoryEntry =
  | {
      kind: 'event';
      id: string;
      at: string;
      actorName: string | null;
      from: ContentStatus | null;
      to: ContentStatus;
      versionNumber: number | null;
      note: string | null;
    }
  | {
      kind: 'review';
      id: string;
      at: string;
      actorName: string | null;
      decision: ReviewDecision;
      versionNumber: number;
      comment: string | null;
    };

export type ContentComment = {
  id: string;
  parentId: string | null;
  authorId: string | null;
  authorName: string | null;
  body: string;
  mentions: { id: string; name: string }[];
  versionNumber: number | null;
  createdAt: string;
  editedAt: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
};

/** Everything the content page needs for its review panel: history, decisions and comments. */
export async function getReviewActivity(orgId: string, itemId: string) {
  const supabase = await createClient();
  const [events, reviews, comments, members] = await Promise.all([
    supabase
      .from('content_events')
      .select(
        'id, created_at, from_status, to_status, note, actor:profiles!content_events_actor_id_fkey(full_name, email), content_versions(version_number)',
      )
      .eq('organization_id', orgId)
      .eq('content_item_id', itemId)
      .order('created_at'),
    supabase
      .from('content_reviews')
      .select(
        'id, created_at, decision, comment, reviewer:profiles!content_reviews_reviewer_id_fkey(full_name, email), content_versions(version_number)',
      )
      .eq('organization_id', orgId)
      .eq('content_item_id', itemId)
      .order('created_at'),
    supabase
      .from('content_comments')
      .select(
        'id, parent_id, author_id, body, mentions, created_at, edited_at, resolved_at, author:profiles!content_comments_author_id_fkey(full_name, email), resolver:profiles!content_comments_resolved_by_fkey(full_name, email), content_versions(version_number)',
      )
      .eq('organization_id', orgId)
      .eq('content_item_id', itemId)
      .order('created_at'),
    supabase
      .from('organization_members')
      .select('user_id, profiles(full_name, email)')
      .eq('organization_id', orgId),
  ]);
  for (const result of [events, reviews, comments, members]) {
    if (result.error) throw result.error;
  }
  const memberName = new Map(
    (members.data ?? []).map((m) => [m.user_id, nameOf(m.profiles) ?? 'Former member']),
  );

  const history: ReviewHistoryEntry[] = [
    ...(events.data ?? []).map((e) => ({
      kind: 'event' as const,
      id: e.id,
      at: e.created_at,
      actorName: nameOf(e.actor),
      from: e.from_status,
      to: e.to_status,
      versionNumber: e.content_versions?.version_number ?? null,
      note: e.note,
    })),
    ...(reviews.data ?? []).map((r) => ({
      kind: 'review' as const,
      id: r.id,
      at: r.created_at,
      actorName: nameOf(r.reviewer),
      decision: r.decision,
      versionNumber: r.content_versions?.version_number ?? 0,
      comment: r.comment,
    })),
  ]
    // A decision and the stage change it causes share a moment; show the decision.
    .filter(
      (entry, _, all) =>
        entry.kind === 'review' ||
        !all.some(
          (other) =>
            other.kind === 'review' &&
            other.decision === entry.to &&
            Math.abs(Date.parse(other.at) - Date.parse(entry.at)) < 2000,
        ),
    )
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const threads: ContentComment[] = (comments.data ?? []).map((c) => ({
    id: c.id,
    parentId: c.parent_id,
    authorId: c.author_id,
    authorName: nameOf(c.author),
    body: c.body,
    mentions: c.mentions.map((id) => ({ id, name: memberName.get(id) ?? 'Former member' })),
    versionNumber: c.content_versions?.version_number ?? null,
    createdAt: c.created_at,
    editedAt: c.edited_at,
    resolvedAt: c.resolved_at,
    resolvedByName: nameOf(c.resolver),
  }));

  const latestReview = (reviews.data ?? []).at(-1) ?? null;
  return {
    history,
    comments: threads,
    latestDecision: latestReview
      ? {
          decision: latestReview.decision,
          comment: latestReview.comment,
          reviewerName: nameOf(latestReview.reviewer),
          versionNumber: latestReview.content_versions?.version_number ?? null,
          at: latestReview.created_at,
        }
      : null,
  };
}

export type ReviewActivity = Awaited<ReturnType<typeof getReviewActivity>>;

export type QueueItem = {
  id: string;
  title: string;
  status: ContentStatus;
  platformKeys: string[];
  countryCode: string | null;
  plannedPublishAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  ownerName: string | null;
  versionNumber: number | null;
  submittedAt: string | null;
  submittedByName: string | null;
  submittedById: string | null;
  openComments: number;
};

const QUEUE_STATUSES: Record<QueueTab, ContentStatus[]> = {
  waiting: ['IN_REVIEW'],
  changes: ['CHANGES_REQUESTED'],
  approved: ['APPROVED', 'SCHEDULED'],
  decided: ['PUBLISHED', 'REJECTED'],
};

/** Content in review, sent back, approved, or recently decided. Oldest waiting first. */
export async function listReviewQueue(orgId: string, tab: QueueTab): Promise<QueueItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_items')
    .select(
      `id, title, status, platform_keys, country_code, planned_publish_at, published_at, updated_at,
       owner:profiles!content_items_owner_user_id_fkey(full_name, email),
       current_version:content_versions!content_items_current_version_fk(version_number, submitted_at, submitted_by, submitter:profiles!content_versions_submitted_by_fkey(full_name, email)),
       content_comments(resolved_at)`,
    )
    .eq('organization_id', orgId)
    .in('status', QUEUE_STATUSES[tab])
    .order('updated_at', { ascending: tab === 'waiting' })
    .limit(tab === 'decided' ? 50 : 200);
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    platformKeys: row.platform_keys,
    countryCode: row.country_code,
    plannedPublishAt: row.planned_publish_at,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    ownerName: nameOf(row.owner),
    versionNumber: row.current_version?.version_number ?? null,
    submittedAt: row.current_version?.submitted_at ?? null,
    submittedByName: nameOf(row.current_version?.submitter ?? null),
    submittedById: row.current_version?.submitted_by ?? null,
    openComments: row.content_comments.filter((c) => !c.resolved_at).length,
  }));
}

/** How many items wait in each queue tab, for the tab labels and the navigation. */
export async function countReviewQueue(orgId: string): Promise<Record<QueueTab, number>> {
  const supabase = await createClient();
  const entries = await Promise.all(
    (Object.entries(QUEUE_STATUSES) as [QueueTab, ContentStatus[]][]).map(
      async ([tab, statuses]) => {
        const { count, error } = await supabase
          .from('content_items')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .in('status', statuses);
        if (error) throw error;
        return [tab, count ?? 0] as const;
      },
    ),
  );
  return Object.fromEntries(entries) as Record<QueueTab, number>;
}

export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  itemId: string | null;
  itemTitle: string | null;
  /** Set on report_ready notifications. */
  reportId: string | null;
  reportWeek: { start: string; end: string } | null;
  actorName: string | null;
  excerpt: string | null;
  readAt: string | null;
  createdAt: string;
};

/** The signed-in person's notifications in this organization, newest first. */
export async function listNotifications(orgId: string, limit = 50): Promise<NotificationItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('notifications')
    .select(
      'id, kind, content_item_id, report_id, excerpt, read_at, created_at, actor:profiles!notifications_actor_id_fkey(full_name, email), content_items(title), reports(period_start, period_end)',
    )
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    kind: row.kind as NotificationKind,
    itemId: row.content_item_id,
    itemTitle: row.content_items?.title ?? null,
    reportId: row.report_id,
    reportWeek: row.reports
      ? { start: row.reports.period_start, end: row.reports.period_end }
      : null,
    actorName: nameOf(row.actor),
    excerpt: row.excerpt,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}

export async function countUnreadNotifications(orgId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}
