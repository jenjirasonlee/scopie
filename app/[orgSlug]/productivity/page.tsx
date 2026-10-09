import { Lock } from 'lucide-react';
import type { Metadata } from 'next';
import { ImpactView } from '@/components/productivity/impact-view';
import { PeriodFilter, ProductivityTabs } from '@/components/productivity/productivity-nav';
import { TeamView } from '@/components/productivity/team-view';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { getOrgContext } from '@/lib/orgs/queries';
import { loadTeamProductivity, loadYourImpact } from '@/lib/productivity/queries';
import {
  formatRange,
  parsePeriodKey,
  parseView,
  PERIOD_WORDS,
  productivityPeriod,
  withinRecords,
} from '@/lib/productivity/shared';
import { utcToZonedParts } from '@/lib/calendar/time';
import { todayIn } from '@/lib/strategy/shared';

export const metadata: Metadata = { title: 'Productivity' };

const SUMMARY_TITLES = {
  this_quarter: 'Your impact this quarter',
  last_quarter: 'Your impact last quarter',
  last_90_days: 'Your impact in the last 90 days',
} as const;

export default async function ProductivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug }, search] = await Promise.all([params, searchParams]);
  const view = parseView(search.view);
  const periodKey = parsePeriodKey(search.period);
  const { org } = await getOrgContext(orgSlug);
  const timeZone = org.default_timezone;
  // getOrgContext has already read request data, so the current time is per request.
  const now = new Date();
  const period = withinRecords(
    productivityPeriod(periodKey, todayIn(timeZone, now)),
    utcToZonedParts(new Date(org.created_at), timeZone).date,
  );
  const common = { orgId: org.id, isDemoOrg: org.is_demo, timeZone, period, now };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Productivity"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {org.is_demo ? <Badge variant="demo">Demo</Badge> : null}
            <span>
              How the team’s work moves through Scopie, from Scopie’s own records only. No tracking
              outside Scopie, and no one is ranked or compared.
              {org.is_demo ? ' This organization holds DEMO DATA; none of it is real.' : ''}
            </span>
          </span>
        }
      />

      <ProductivityTabs orgSlug={orgSlug} view={view} period={periodKey} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodFilter orgSlug={orgSlug} view={view} period={periodKey} />
        <p className="text-muted-foreground text-xs">
          {formatRange(period.range)}
          {period.comparison
            ? `, compared with ${period.comparisonLabel} (${formatRange(period.comparison)})`
            : ''}
          . Days in {timeZone}.{period.noComparison ? ` ${period.noComparison}` : ''}
        </p>
      </div>

      {view === 'team' ? (
        <>
          <p className="text-muted-foreground text-[13px]">
            Numbers for the whole team together. Scopie doesn’t break them down by person.
          </p>
          <TeamView
            team={await loadTeamProductivity(common)}
            orgSlug={orgSlug}
            comparisonLabel={period.comparisonLabel}
          />
        </>
      ) : (
        <>
          <div
            role="note"
            className="bg-muted/50 flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]"
          >
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              <strong className="font-medium">Private: only you can see this.</strong> Scopie builds
              this page for you when you open it, from your own records, and never shows it about
              you to anyone else, admins included. The records themselves (content, reviews,
              reports) stay visible to your team where they already are.
            </span>
          </div>
          <ImpactView
            impact={await loadYourImpact(common)}
            orgSlug={orgSlug}
            timeZone={timeZone}
            comparisonLabel={period.comparisonLabel}
            summaryTitle={SUMMARY_TITLES[periodKey]}
            periodWords={PERIOD_WORDS[periodKey]}
          />
        </>
      )}
    </div>
  );
}
