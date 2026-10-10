import { Info, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { GettingStarted, type ChecklistItem } from '@/components/dashboard/getting-started';
import { InsightsPanel } from '@/components/dashboard/insights-panel';
import { PlatformFilter, RangeFilter } from '@/components/dashboard/range-filter';
import {
  CompareTable,
  Headlines,
  WhatWorks,
  WinningPosts,
} from '@/components/dashboard/marketer-sections';
import { DataSourceBadge } from '@/components/pipeline/data-source-badge';
import { PageHeader } from '@/components/shared/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  const { model, marketer, hasViewer, countriesMissing } = await loadDashboard({
    orgId: org.id,
    orgSlug,
    isDemoOrg: org.is_demo,
    timeZone: org.default_timezone,
    platformKey: typeof search.platform === 'string' ? search.platform : null,
    days,
    now,
  });

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
          : 'How your profiles compare with the ones you watch, and what is working for them.'
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
        <RangeFilter orgSlug={orgSlug} days={days} platform={marketer.platformKey} />
        <PlatformFilter
          orgSlug={orgSlug}
          days={days}
          platforms={marketer.platforms}
          current={marketer.platformKey}
        />
        <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
          {formatPeriod(model.periods.current)} · compared on
          <DataSourceBadge source={model.source} />
          data
        </p>
      </div>

      <GettingStarted items={checklist} />

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

      <Headlines view={marketer} />

      <CompareTable view={marketer} orgSlug={orgSlug} />

      <WinningPosts view={marketer} orgSlug={orgSlug} timeZone={org.default_timezone} />

      <div className="grid gap-6 xl:grid-cols-2">
        <WhatWorks view={marketer} />
        <InsightsPanel insights={model.insights.slice(0, 5)} periods={model.periods} />
      </div>

      <p className="text-muted-foreground text-[13px]">
        Want the detail behind these numbers? See{' '}
        <Link href={`/${orgSlug}/benchmarks`} className="text-primary font-medium hover:underline">
          Benchmarks
        </Link>{' '}
        for rankings and trends, or{' '}
        <Link href={`/${orgSlug}/analytics`} className="text-primary font-medium hover:underline">
          Analytics
        </Link>{' '}
        for every post.
      </p>
    </div>
  );
}
