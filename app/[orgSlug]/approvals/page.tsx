import type { Metadata } from 'next';
import { QueueTable } from '@/components/approvals/queue-table';
import { QueueTabs } from '@/components/approvals/queue-tabs';
import { QUEUE_TAB_EMPTY } from '@/components/approvals/queue-shared';
import { PageHeader } from '@/components/shared/page-header';
import { listCountries, listPlatforms } from '@/lib/accounts/queries';
import { countReviewQueue, listReviewQueue } from '@/lib/approvals/queries';
import { parseQueueTab } from '@/lib/approvals/shared';
import { can } from '@/lib/auth/permissions';
import { utcToZonedParts } from '@/lib/calendar/time';
import { getOrgContext } from '@/lib/orgs/queries';

export const metadata: Metadata = { title: 'Approvals' };

export default async function ApprovalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug }, search] = await Promise.all([params, searchParams]);
  const tab = parseQueueTab(Array.isArray(search.tab) ? search.tab[0] : search.tab);
  const { org, role, user } = await getOrgContext(orgSlug);
  const canReview = can(role, 'content.approve');
  const [items, counts, platforms, countries] = await Promise.all([
    listReviewQueue(org.id, tab),
    countReviewQueue(org.id),
    listPlatforms(),
    listCountries(),
  ]);
  const empty = QUEUE_TAB_EMPTY[tab];
  // getOrgContext has already read request data, so the current time is per request.
  const currentYear = Number(utcToZonedParts(new Date(), org.default_timezone).date.slice(0, 4));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Approvals"
        description={
          org.is_demo
            ? `${org.name}. Everything below is DEMO DATA generated for testing; none of it is real.`
            : 'Content waiting for a decision, sent back for changes, or already decided. Open an item to review it.'
        }
      />

      <div className="space-y-4">
        <QueueTabs orgSlug={orgSlug} active={tab} counts={counts} />
        <p className="text-muted-foreground text-[13px]">
          {canReview
            ? role === 'MANAGER'
              ? 'Open an item to approve it, ask for changes or reject it. Someone else reviews content you submitted.'
              : 'Open an item to approve it, ask for changes or reject it.'
            : 'You can follow the queue here. Managers, admins and owners review content.'}
        </p>

        {items.length === 0 ? (
          <div className="bg-card rounded-lg border border-dashed px-6 py-12 text-center">
            <p className="font-medium">{empty.title}</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-md text-[13px]">{empty.body}</p>
          </div>
        ) : (
          <>
            <QueueTable
              orgSlug={orgSlug}
              tab={tab}
              items={items}
              role={role}
              currentUserId={user.id}
              timeZone={org.default_timezone}
              currentYear={currentYear}
              platformNames={new Map(platforms.map((p) => [p.key, p.name]))}
              countryNames={new Map(countries.map((c) => [c.code, c.name]))}
            />
            <p className="text-muted-foreground text-xs">
              {tab === 'decided' && items.length >= 50
                ? `Showing the 50 most recent. Times in ${org.default_timezone}.`
                : `Times in ${org.default_timezone}.`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
