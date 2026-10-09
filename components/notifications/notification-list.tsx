import Link from 'next/link';
import { openNotification } from '@/app/[orgSlug]/notifications/actions';
import { SubmitButton } from '@/components/shared/submit-button';
import { markNotificationsRead } from '@/lib/approvals/actions';
import type { NotificationItem } from '@/lib/approvals/queries';
import { NOTIFICATION_TEXT } from '@/lib/approvals/shared';
import {
  formatAbsoluteTime,
  formatNotificationTime,
  notificationHref,
} from '@/lib/notifications/shared';
import { reportReadyText } from '@/lib/reports/shared';
import { cn } from '@/lib/utils';

/** Notifications, newest first. Opening an unread one marks it read. */
export function NotificationList({
  orgSlug,
  notifications,
  now,
  timeZone,
}: {
  orgSlug: string;
  notifications: NotificationItem[];
  now: Date;
  timeZone: string;
}) {
  const markRead = markNotificationsRead.bind(null, orgSlug);
  const open = openNotification.bind(null, orgSlug);
  return (
    <ul className="bg-card divide-y rounded-lg border">
      {notifications.map((n) => {
        const unread = !n.readAt;
        const href = notificationHref(orgSlug, n);
        const formId = `open-${n.id}`;
        const title = n.itemTitle ?? 'content that was deleted';
        return (
          <li
            key={n.id}
            className={cn('flex items-start gap-3 px-4 py-3', unread && 'bg-primary/5')}
          >
            <span
              aria-hidden
              className={cn(
                'mt-1.5 size-2 shrink-0 rounded-full',
                unread ? 'bg-primary' : 'bg-transparent',
              )}
            />
            <div className="min-w-0 flex-1">
              <p
                className={cn('text-[13px]', unread ? 'text-foreground' : 'text-muted-foreground')}
              >
                {unread ? <span className="sr-only">Unread: </span> : null}
                {n.kind === 'report_ready' ? (
                  <>
                    <Target href={href} formId={formId} unread={unread}>
                      {reportReadyText(n.reportWeek)}
                    </Target>
                    {n.actorName ? (
                      <span className="text-muted-foreground"> · made by {n.actorName}</span>
                    ) : null}
                  </>
                ) : (
                  <>
                    <span className="text-foreground font-medium">{n.actorName ?? 'Someone'}</span>{' '}
                    {NOTIFICATION_TEXT[n.kind]}{' '}
                    <Target href={href} formId={formId} unread={unread}>
                      {title}
                    </Target>
                  </>
                )}
              </p>
              {/* A report notification's excerpt is its title, which the line above already says. */}
              {n.excerpt && n.kind !== 'report_ready' ? (
                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[13px] break-words">
                  “{n.excerpt}”
                </p>
              ) : null}
              <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                <time dateTime={n.createdAt} title={formatAbsoluteTime(n.createdAt, timeZone)}>
                  {formatNotificationTime(n.createdAt, now, timeZone)}
                </time>
              </p>
              {unread && href ? (
                <form id={formId} action={open} hidden>
                  <input type="hidden" name="notificationId" value={n.id} />
                </form>
              ) : null}
            </div>
            {unread ? (
              <form action={markRead} className="shrink-0">
                <input type="hidden" name="notificationId" value={n.id} />
                <SubmitButton variant="ghost" size="sm" pendingLabel="Marking…">
                  Mark as read
                </SubmitButton>
              </form>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * What the notification is about: a button that marks it read and opens it while unread, a
 * plain link once read, and plain text when there is nothing left to open.
 */
function Target({
  href,
  formId,
  unread,
  children,
}: {
  href: string | null;
  formId: string;
  unread: boolean;
  children: React.ReactNode;
}) {
  if (!href) return <span className="italic">{children}</span>;
  if (unread) {
    return (
      <button
        type="submit"
        form={formId}
        className="text-foreground cursor-pointer text-left font-medium hover:underline"
      >
        {children}
      </button>
    );
  }
  return (
    <Link href={href} className="text-foreground font-medium hover:underline">
      {children}
    </Link>
  );
}
