import { Info, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { GettingStarted, type ChecklistItem } from '@/components/dashboard/getting-started';
import { InsightsPanel } from '@/components/dashboard/insights-panel';
import { RangeFilter } from '@/components/dashboard/range-filter';
import {
  ComparisonTable,
  FollowerTrend,
  GroupComparison,
  Hashtags,
  PostingFrequency,
  Tiles,
  TopEngagement,
  TopPosts,
} from '@/components/dashboard/sections';
import { DataSourceBadge } from '@/components/pipeline/data-source-badge';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { listCountries } from '@/lib/accounts/queries';
import { loadDashboard } from '@/lib/analytics/queries';
import { formatPeriod, parseRangeParam } from '@/lib/analytics/range';
import { can } from '@/lib/auth/permissions';
import { getOrgContext } from '@/lib/orgs/queries';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug }, search] = await Promise.all([params, searchParams]);
  const days = parseRangeParam(search.range);
  const { org, role } = await getOrgContext(orgSlug);
  const canManage = can(role, 'accounts.manage');
  // getOrgContext has already read request data, so the current time is per request.
  const now = new Date();
  const [{ model, hasViewer, countriesMissing }, countries] = await Promise.all([
    loadDashboard({ orgId: org.id, orgSlug, isDemoOrg: org.is_demo, days, now }),
    listCountries(),
  ]);
  const countryNames = new Map(countries.map((c) => [c.code, c.name]));

  const checklist: ChecklistItem[] = [
    {
      label: 'Add the profiles you want to monitor',
      done: model.tiles.active > 0,
      href: `/${orgSlug}/accounts/new`,
      help: 'Competitors, industry accounts, creators and your own profiles, by username.',
    },
    ...(org.is_demo
      ? []
      : [
          {
            label: 'Choose a viewer account for public data',
            done: hasViewer,
            href: `/${orgSlug}/settings/public-data`,
            help: 'Scopie reads public Instagram data through one professional account you manage.',
          },
        ]),
    {
      label: 'Assign a country to every profile',
      done: model.tiles.active > 0 && countriesMissing === 0,
      href: `/${orgSlug}/accounts`,
    },
    {
      label: 'Connect your own accounts for private metrics',
      done: (model.tiles.byAccess.connected ?? 0) > 0,
      href: `/${orgSlug}/settings/connections`,
      optional: true,
    },
  ];

  const header = (
    <PageHeader
      title="Dashboard"
      description={
        org.is_demo
          ? `${org.name}. Everything below is DEMO DATA generated for testing; none of it is real.`
          : `Public social intelligence for ${org.name}, from what Scopie has actually observed.`
      }
      actions={
        canManage ? (
          <Button asChild size="sm">
            <Link href={`/${orgSlug}/accounts/new`}>
              <Plus aria-hidden />
              Add profile
            </Link>
          </Button>
        ) : null
      }
    />
  );

  if (model.tiles.active === 0) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <h2 className="text-base font-semibold">No profiles to monitor yet</h2>
            <p className="text-muted-foreground mx-auto max-w-lg text-[13px]">
              Add a competitor, an industry account, a creator or one of your own profiles by its
              username. Scopie starts observing it the same day and builds its history from then on;
              numbers from before that day aren’t available and are never estimated.
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {canManage ? (
                <Button asChild size="sm">
                  <Link href={`/${orgSlug}/accounts/new`}>Accounts → Add profile</Link>
                </Button>
              ) : null}
              {!org.is_demo ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/${orgSlug}/settings/public-data`}>Settings → Public data</Link>
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
        <GettingStarted items={checklist} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <RangeFilter orgSlug={orgSlug} days={days} />
        <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
          {formatPeriod(model.periods.current)} · compared on
          <DataSourceBadge source={model.source} />
          data
        </p>
      </div>

      {!model.hasAnyObservation ? (
        <Alert variant="info">
          <Info aria-hidden />
          <AlertTitle>Nothing has been observed yet</AlertTitle>
          <AlertDescription>
            Scopie observes each public profile once a day from the day it was added. Growth needs
            two observations a day apart; engagement needs posts that are 7 days old.
            {!org.is_demo && !hasViewer ? (
              <>
                {' '}
                First,{' '}
                <Link
                  href={`/${orgSlug}/settings/public-data`}
                  className="font-medium underline underline-offset-2"
                >
                  choose a viewer account in Settings → Public data
                </Link>
                .
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <Tiles model={model} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <InsightsPanel insights={model.insights} periods={model.periods} />
        <GettingStarted items={checklist} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <FollowerTrend model={model} orgSlug={orgSlug} />
        <PostingFrequency model={model} orgSlug={orgSlug} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <TopEngagement model={model} orgSlug={orgSlug} />
        <TopPosts model={model} orgSlug={orgSlug} />
      </div>

      <ComparisonTable model={model} orgSlug={orgSlug} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <GroupComparison model={model} countryNames={countryNames} />
        <Hashtags model={model} />
      </div>
    </div>
  );
}
