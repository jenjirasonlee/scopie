import { Plus, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BenchmarkControls } from '@/components/benchmarks/benchmark-controls';
import { CountryCard } from '@/components/benchmarks/country-card';
import { PeriodCard } from '@/components/benchmarks/period-card';
import { RankingCard } from '@/components/benchmarks/ranking-card';
import { DataSourceBadge } from '@/components/pipeline/data-source-badge';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { listCountries } from '@/lib/accounts/queries';
import { parseMetricParam } from '@/lib/analytics/benchmark';
import { buildBenchmarkView } from '@/lib/analytics/benchmark-view';
import { platformName } from '@/lib/analytics/names';
import { loadBenchmarkData } from '@/lib/analytics/queries';
import { formatPeriod, parseRangeParam } from '@/lib/analytics/range';
import { can } from '@/lib/auth/permissions';
import { listBenchmarkGroups } from '@/lib/benchmarks/queries';
import { getOrgContext } from '@/lib/orgs/queries';

export const metadata: Metadata = { title: 'Benchmarks' };

function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BenchmarksPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug }, search] = await Promise.all([params, searchParams]);
  const days = parseRangeParam(search.range);
  const metric = parseMetricParam(search.metric);
  const { org, role } = await getOrgContext(orgSlug);
  const canManage = can(role, 'accounts.manage');
  // getOrgContext has already read request data, so the current time is per request.
  const now = new Date();
  const [benchmark, groups, countries] = await Promise.all([
    loadBenchmarkData({ orgId: org.id, isDemoOrg: org.is_demo, days, now }),
    listBenchmarkGroups(org.id),
    listCountries(),
  ]);
  const countryNames = new Map(countries.map((c) => [c.code, c.name]));
  const view = buildBenchmarkView({
    metric,
    set: param(search.set),
    platform: param(search.platform),
    days,
    now,
    source: benchmark.source,
    profiles: benchmark.profiles,
    data: benchmark.data,
    groups,
  });

  const header = (
    <PageHeader
      title="Benchmarks"
      description={
        org.is_demo
          ? `${org.name}. Everything below is DEMO DATA generated for testing; none of it is real.`
          : 'How monitored profiles compare on the same public numbers, from what Scopie has actually observed. Comparisons describe differences; they don’t explain them.'
      }
      actions={
        <>
          <Button asChild size="sm" variant="outline">
            <Link href={`/${orgSlug}/benchmarks/groups`}>
              <Users aria-hidden />
              {canManage ? 'Manage groups' : 'View groups'}
            </Link>
          </Button>
          {canManage ? (
            <Button asChild size="sm">
              <Link href={`/${orgSlug}/accounts/new`}>
                <Plus aria-hidden />
                Add profile
              </Link>
            </Button>
          ) : null}
        </>
      }
    />
  );

  const activeProfiles = benchmark.profiles.filter((p) => p.isActive);
  if (activeProfiles.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState orgSlug={orgSlug} canManage={canManage} title="No profiles to benchmark yet">
          Benchmarks rank the profiles Scopie monitors: competitors, industry accounts, creators and
          your own profiles. Add them by username; Scopie observes each one from the day it’s added
          and never estimates what came before.
        </EmptyState>
      </div>
    );
  }

  const note =
    view.platformKey === 'youtube' && (metric === 'follower_growth' || metric === 'followers')
      ? 'YouTube shows subscriber counts rounded, so small changes may not appear.'
      : null;

  return (
    <div className="space-y-6">
      {header}

      <BenchmarkControls
        orgSlug={orgSlug}
        metric={metric}
        set={view.setKey}
        platform={view.platformKey ?? ''}
        days={days}
        groups={groups.map((g) => ({ id: g.id, name: g.name, members: g.memberIds.length }))}
        platforms={view.platforms}
      />

      <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
        {formatPeriod(view.periods.current)} vs {formatPeriod(view.periods.previous)} · compared on
        <DataSourceBadge source={benchmark.source} />
        data only{view.platformKey ? ` · ${platformName(view.platformKey)}` : ''} ·{' '}
        {view.setProfiles.length} profile{view.setProfiles.length === 1 ? '' : 's'} in{' '}
        {view.setLabel}
      </p>

      {!view.ranking || !view.platformKey ? (
        <EmptyState orgSlug={orgSlug} canManage={canManage} title="This group has no profiles yet">
          Add profiles to the group on the{' '}
          <Link
            href={`/${orgSlug}/benchmarks/groups`}
            className="font-medium underline underline-offset-2"
          >
            Benchmark groups
          </Link>{' '}
          page, or pick “All monitored profiles”.
        </EmptyState>
      ) : (
        <>
          <RankingCard ranking={view.ranking} orgSlug={orgSlug} note={note} />
          <div className="grid gap-6">
            <CountryCard ranking={view.ranking} rows={view.countries} countryNames={countryNames} />
            <PeriodCard
              metric={metric}
              platformKey={view.platformKey}
              source={benchmark.source}
              periods={view.periods}
              days={days}
              groups={view.periodGroups}
              rows={view.periodRows}
              orgSlug={orgSlug}
            />
          </div>
        </>
      )}

      {groups.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          Tip: a benchmark group, such as “Spain competitors”, lets you rank a chosen set of
          profiles.{' '}
          {canManage ? (
            <Link
              href={`/${orgSlug}/benchmarks/groups`}
              className="text-primary font-medium hover:underline"
            >
              Create a group
            </Link>
          ) : (
            'Owners and admins can create groups.'
          )}
        </p>
      ) : null}
    </div>
  );
}

function EmptyState({
  orgSlug,
  canManage,
  title,
  children,
}: {
  orgSlug: string;
  canManage: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 py-8 text-center">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-muted-foreground mx-auto max-w-lg text-[13px]">{children}</p>
        {canManage ? (
          <Button asChild size="sm">
            <Link href={`/${orgSlug}/accounts/new`}>Accounts → Add profile</Link>
          </Button>
        ) : (
          <p className="text-muted-foreground text-xs">
            Owners and admins can add profiles in Accounts → Add profile.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
