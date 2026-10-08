import { MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { PlatformMark } from '@/components/accounts/platform-mark';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { QueueTab } from '@/lib/approvals/shared';
import type { QueueItem } from '@/lib/approvals/queries';
import type { OrgRole } from '@/lib/auth/permissions';
import { CONTENT_STATUS_LABELS, CONTENT_STATUS_VARIANT } from '@/lib/content/shared';
import { formatAbsoluteTime } from '@/lib/notifications/shared';
import { needsAnotherReviewer } from './queue-shared';

export function QueueTable({
  orgSlug,
  tab,
  items,
  role,
  currentUserId,
  timeZone,
  currentYear,
  platformNames,
  countryNames,
}: {
  orgSlug: string;
  tab: QueueTab;
  items: QueueItem[];
  role: OrgRole;
  currentUserId: string;
  timeZone: string;
  /** Dates in this year leave the year out. */
  currentYear: number;
  platformNames: Map<string, string>;
  countryNames: Map<string, string>;
}) {
  const when = (iso: string) => formatAbsoluteTime(iso, timeZone, currentYear);
  const showSubmitted = tab === 'waiting';
  return (
    <div className="bg-card overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Platforms</TableHead>
            <TableHead>Country</TableHead>
            <TableHead>Publish</TableHead>
            {showSubmitted ? <TableHead>Submitted</TableHead> : null}
            <TableHead>Owner</TableHead>
            <TableHead className="text-right">Version</TableHead>
            <TableHead className="text-right" title="Comments nobody has resolved yet">
              Open comments
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const ownSubmission =
              showSubmitted && needsAnotherReviewer(role, currentUserId, item.submittedById);
            return (
              <TableRow key={item.id}>
                <TableCell className="max-w-72 min-w-48 whitespace-normal">
                  <Link
                    href={`/${orgSlug}/content/${item.id}`}
                    className="text-foreground font-medium hover:underline"
                  >
                    {item.title}
                  </Link>
                  {ownSubmission ? (
                    <div className="mt-1">
                      <Badge
                        variant="outline"
                        title="You submitted this, so someone else reviews it."
                      >
                        Needs another reviewer
                      </Badge>
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant={CONTENT_STATUS_VARIANT[item.status]}>
                    {CONTENT_STATUS_LABELS[item.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    {item.platformKeys.length
                      ? item.platformKeys.map((key) => (
                          <span key={key} title={platformNames.get(key) ?? key}>
                            <PlatformMark platformKey={key} />
                          </span>
                        ))
                      : '—'}
                  </span>
                </TableCell>
                <TableCell>
                  {item.countryCode
                    ? (countryNames.get(item.countryCode) ?? item.countryCode)
                    : 'All'}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {item.publishedAt
                    ? `Published ${when(item.publishedAt)}`
                    : item.plannedPublishAt
                      ? when(item.plannedPublishAt)
                      : 'Not planned'}
                </TableCell>
                {showSubmitted ? (
                  <TableCell className="whitespace-nowrap">
                    {item.submittedById === currentUserId ? 'You' : (item.submittedByName ?? '—')}
                    {item.submittedAt ? (
                      <span className="text-muted-foreground block text-xs tabular-nums">
                        {when(item.submittedAt)}
                      </span>
                    ) : null}
                  </TableCell>
                ) : null}
                <TableCell>{item.ownerName ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.versionNumber ?? '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.openComments > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="text-muted-foreground size-3.5" aria-hidden />
                      {item.openComments}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
