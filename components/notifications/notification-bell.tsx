import { Bell } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { badgeCount } from '@/lib/notifications/shared';

/** Header link to the notifications page, with the unread count. */
export function NotificationBell({ orgSlug, unread }: { orgSlug: string; unread: number }) {
  const shown = badgeCount(unread);
  return (
    <Button asChild variant="ghost" size="icon" className="relative">
      <Link
        href={`/${orgSlug}/notifications`}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
      >
        <Bell aria-hidden />
        {shown ? (
          <span
            aria-hidden
            className="bg-primary text-primary-foreground absolute top-0.5 right-0 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-semibold tabular-nums"
          >
            {shown}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}
