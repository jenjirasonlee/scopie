import { utcToZonedParts } from '@/lib/calendar/time';
import type { NotificationKind } from '@/lib/approvals/shared';
import { reportHref } from '@/lib/reports/shared';

/**
 * Where a notification leads: the report for a new report, else the content, or its
 * comments for comment notifications.
 */
export function notificationHref(
  orgSlug: string,
  notification: { kind: NotificationKind; itemId: string | null; reportId?: string | null },
): string | null {
  if (notification.kind === 'report_ready') {
    return notification.reportId ? reportHref(orgSlug, notification.reportId) : null;
  }
  if (!notification.itemId) return null;
  const href = `/${orgSlug}/content/${notification.itemId}`;
  return notification.kind === 'mentioned' || notification.kind === 'commented'
    ? `${href}#comments`
    : href;
}

/** A count for a small badge: 1 to 99, then "99+". Nothing for zero. */
export function badgeCount(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? '99+' : String(Math.floor(count));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "8 Oct 2026, 14:05" in the organization's time zone, or "8 Oct, 14:05" when `omitYear` matches. */
export function formatAbsoluteTime(iso: string, timeZone: string, omitYear?: number): string {
  const { date, time } = utcToZonedParts(new Date(iso), timeZone);
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return year === omitYear
    ? `${day} ${MONTHS[month - 1]}, ${time}`
    : `${day} ${MONTHS[month - 1]} ${year}, ${time}`;
}

/**
 * How long ago something happened, in plain words: "Just now", "5 minutes ago",
 * "3 hours ago". Anything a day or older shows the date and time in the organization's
 * time zone instead.
 */
export function formatNotificationTime(iso: string, now: Date, timeZone: string): string {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  return formatAbsoluteTime(iso, timeZone, Number(utcToZonedParts(now, timeZone).date.slice(0, 4)));
}
