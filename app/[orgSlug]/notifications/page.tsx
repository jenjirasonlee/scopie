import type { Metadata } from 'next';
import { NotificationList } from '@/components/notifications/notification-list';
import { PageHeader } from '@/components/shared/page-header';
import { SubmitButton } from '@/components/shared/submit-button';
import { markNotificationsRead } from '@/lib/approvals/actions';
import { listNotifications } from '@/lib/approvals/queries';
import { getOrgContext } from '@/lib/orgs/queries';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { org } = await getOrgContext(orgSlug);
  const notifications = await listNotifications(org.id);
  // getOrgContext has already read request data, so the current time is per request.
  const now = new Date();
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description={
          org.is_demo
            ? `${org.name}. Everything below is DEMO DATA generated for testing; none of it is real.`
            : 'Review requests, decisions, comments and mentions on content in this organization.'
        }
        actions={
          unread > 0 ? (
            <form action={markNotificationsRead.bind(null, orgSlug)}>
              <SubmitButton variant="outline" pendingLabel="Marking…">
                Mark all as read
              </SubmitButton>
            </form>
          ) : null
        }
      />

      {notifications.length === 0 ? (
        <div className="bg-card rounded-lg border border-dashed px-6 py-12 text-center">
          <p className="font-medium">No notifications yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-[13px]">
            You’ll hear here when someone asks you to review content, decides on content you wrote,
            or mentions you in a comment.
          </p>
        </div>
      ) : (
        <NotificationList
          orgSlug={orgSlug}
          notifications={notifications}
          now={now}
          timeZone={org.default_timezone}
        />
      )}
      <p className="text-muted-foreground text-xs">
        Notifications show up here in Scopie only. No emails are sent yet.
      </p>
    </div>
  );
}
