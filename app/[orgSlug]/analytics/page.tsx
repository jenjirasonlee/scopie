import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ExplorerCard } from '@/components/analytics/explorer-card';
import { ExplorerControls } from '@/components/analytics/explorer-controls';
import { DataSourceBadge } from '@/components/pipeline/data-source-badge';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { listCountries } from '@/lib/accounts/queries';
import { buildExplorerView, explorerHref, viewParams } from '@/lib/analytics/explorer';
import { loadExplorerData } from '@/lib/analytics/explorer-queries';
import { formatCount } from '@/lib/analytics/format';
import { platformName } from '@/lib/analytics/names';
import { formatPeriod, parseRangeParam, periodsFor } from '@/lib/analytics/range';
import { can } from '@/lib/auth/permissions';
import { getOrgContext } from '@/lib/orgs/queries';

export const metadata: Metadata = { title: 'Analytics' };

export default async function AnalyticsPage({
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
  const period = periodsFor(new Date(), days).current;
  const [data, countries] = await Promise.all([
    loadExplorerData({ orgId: org.id, isDemoOrg: org.is_demo, period }),
    listCountries(),
  ]);
  const countryNames = new Map(countries.map((c) => [c.code, c.name]));
  const names = {
    countries: countryNames,
    pillars: new Map(data.pillars.map((p) => [p.id, p.name])),
    campaigns: new Map(data.campaigns.map((c) => [c.id, c.name])),
  };
  const view = buildExplorerView({
    search,
    posts: data.posts,
    sources: data.sources,
    period,
    hasPillars: data.pillars.length > 0,
    hasCampaigns: data.campaigns.length > 0,
    names,
  });
  const current = viewParams(view, days);

  const header = (
    <PageHeader
      title="Analytics"
      description={
        org.is_demo
          ? `${org.name}. Everything below is DEMO DATA generated for testing; none of it is real.`
          : 'How stored posts performed, compared by country, profile, platform or format. Only values Scopie has stored are used, and only comparable ones are compared. Comparisons describe differences; they don’t explain them.'
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

  if (!data.posts.length) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <h2 className="text-base font-semibold">No posts in the last {days} days</h2>
            <p className="text-muted-foreground mx-auto max-w-lg text-[13px]">
              Analytics explores the posts Scopie has stored for your profiles, competitors and
              other monitored accounts. Posts appear once a profile is observed, connected or
              imported; nothing is estimated.
            </p>
            {days < 90 ? (
              <Button asChild size="sm" variant="outline">
                <Link href={explorerHref(orgSlug, { range: '90' })}>Show the last 90 days</Link>
              </Button>
            ) : canManage ? (
              <Button asChild size="sm">
                <Link href={`/${orgSlug}/accounts/new`}>Accounts → Add profile</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <ExplorerControls
        orgSlug={orgSlug}
        days={days}
        view={view}
        countryNames={countryNames}
        pillars={data.pillars}
        campaigns={data.campaigns}
      />

      <div className="text-muted-foreground space-y-1 text-xs">
        <p className="flex flex-wrap items-center gap-1.5">
          Posts published {formatPeriod(period)} ·{' '}
          {view.filters.platform ? platformName(view.filters.platform) : 'all platforms'} ·{' '}
          {formatCount(view.posts.length)} post{view.posts.length === 1 ? '' : 's'} match · values
          from
          <DataSourceBadge source={view.source} />
          data only
        </p>
        {view.notComparable.length ? (
          <p>
            Not comparable across these platforms, so not offered:{' '}
            {view.notComparable.map((m) => m.label.toLowerCase()).join(', ')}. Each platform
            measures them differently; pick one platform to compare them.
          </p>
        ) : null}
      </div>

      <ExplorerCard
        view={view}
        orgSlug={orgSlug}
        definition={data.definitions.get(view.metricKey)}
        platformHref={(platformKey) => explorerHref(orgSlug, current, { platform: platformKey })}
      />
    </div>
  );
}
