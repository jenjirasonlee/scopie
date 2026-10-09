import { ArrowLeft, FileDown, Info } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataSourceBadge } from '@/components/pipeline/data-source-badge';
import { CopyLinkButton, PrintButton } from '@/components/reports/report-buttons';
import {
  ActionList,
  InsightGroup,
  KpiTiles,
  RankingTable,
  ReportSection,
  StrategyList,
  TopContentTable,
} from '@/components/reports/report-sections';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getOrgContext } from '@/lib/orgs/queries';
import { getReport } from '@/lib/reports/queries';
import { formatWeek, madeByLine, reportWriterSentences } from '@/lib/reports/shared';

export const metadata: Metadata = { title: 'Weekly report' };

export default async function ReportPage({
  params,
}: {
  params: Promise<{ orgSlug: string; reportId: string }>;
}) {
  const { orgSlug, reportId } = await params;
  const { org } = await getOrgContext(orgSlug);
  const report = await getReport(org.id, reportId);
  if (!report) notFound();

  const result = report.snapshot;
  const snapshot = result.status === 'ok' ? result.snapshot : null;
  // The report's own time zone, as it was when the report was made.
  const timeZone = snapshot?.timeZone ?? report.timeZone;
  const week = formatWeek(snapshot?.week ?? report.week);
  const dataSource = snapshot?.dataSource ?? report.dataSource;
  const isDemo = snapshot ? snapshot.isDemo : dataSource === 'demo';

  return (
    <div className="space-y-8">
      <PageHeader
        title={report.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {isDemo ? <Badge variant="demo">Demo</Badge> : null}
            {/* The DEMO badge already says where demo numbers came from. */}
            {isDemo && dataSource === 'demo' ? null : <DataSourceBadge source={dataSource} />}
            <span>
              {week ? `Covers ${week}` : 'Weekly report'} ·{' '}
              {madeByLine(report.madeBy, report.createdByName, report.createdAt, timeZone)}
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${orgSlug}/reports`}>
                <ArrowLeft aria-hidden />
                All reports
              </Link>
            </Button>
            <CopyLinkButton />
            <PrintButton />
            {snapshot ? (
              <Button asChild size="sm" variant="outline">
                {/* A plain link: the browser downloads the file the route sends. */}
                <a href={`/api/reports/${report.id}/pdf`} download>
                  <FileDown aria-hidden />
                  Download PDF
                </a>
              </Button>
            ) : null}
          </div>
        }
      />

      {snapshot ? (
        <>
          {snapshot.isDemo ? (
            <p className="text-warning-foreground text-[13px] font-medium">
              This report was made from DEMO DATA generated for testing. None of it is real.
            </p>
          ) : null}

          <ReportSection
            id="summary"
            title="Summary"
            empty={snapshot.summary.length ? undefined : null}
          >
            <ul className="max-w-3xl list-disc space-y-1 pl-5 text-sm leading-relaxed">
              {snapshot.summary.map((sentence, index) => (
                <li key={index}>{sentence}</li>
              ))}
            </ul>
          </ReportSection>

          <ReportSection
            id="kpis"
            title="The week in numbers"
            description={`Compared with the week before (${formatWeek(snapshot.previousWeek) ?? 'previous week'}). Hover a number for what it is made of.`}
            empty={snapshot.kpis.length ? undefined : 'No numbers to report for this week.'}
          >
            <KpiTiles kpis={snapshot.kpis} />
          </ReportSection>

          <ReportSection
            id="markets"
            title="Markets"
            description="Your own profiles ranked by follower growth during the week, one ranking per platform."
            empty={
              snapshot.markets.length ? undefined : 'Nothing to report: no own profiles to rank.'
            }
          >
            <div className={rankingGrid(snapshot.markets.length)}>
              {snapshot.markets.map((ranking) => (
                <RankingTable key={ranking.platformKey} ranking={ranking} orgSlug={orgSlug} />
              ))}
            </div>
          </ReportSection>

          <ReportSection
            id="competitors"
            title="Competitor watch"
            description="Your own profiles and competitors together, ranked by follower growth during the week."
            empty={
              snapshot.competitors.length
                ? undefined
                : 'Nothing to report: no competitors are monitored.'
            }
          >
            <div className={rankingGrid(snapshot.competitors.length)}>
              {snapshot.competitors.map((ranking) => (
                <RankingTable
                  key={ranking.platformKey}
                  ranking={ranking}
                  orgSlug={orgSlug}
                  showRole
                />
              ))}
            </div>
          </ReportSection>

          <ReportSection
            id="top-content"
            title="Top content"
            description="Your own posts published this week with the most engagement."
            empty={
              snapshot.topContent.length ? undefined : 'Nothing to report: no posts this week.'
            }
          >
            <TopContentTable posts={snapshot.topContent} orgSlug={orgSlug} timeZone={timeZone} />
          </ReportSection>

          <ReportSection
            id="strategy"
            title="Strategy"
            description="Where each active strategy stood at the end of the week."
            empty={
              snapshot.strategies.length ? undefined : 'Nothing to report: no active strategies.'
            }
          >
            <StrategyList strategies={snapshot.strategies} orgSlug={orgSlug} />
          </ReportSection>

          {snapshot.analysis ? (
            <ReportSection id="insights" title="Insights">
              <div className="space-y-6">
                <InsightGroup
                  title="Key insights"
                  insights={snapshot.insights.key}
                  empty="Nothing stood out enough to report."
                />
                <InsightGroup
                  title="Opportunities"
                  insights={snapshot.insights.opportunities}
                  empty="No opportunities found this week."
                />
                <InsightGroup
                  title="Risks"
                  insights={snapshot.insights.risks}
                  empty="No risks found this week."
                />
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">
                    Recommended actions{' '}
                    <span className="text-muted-foreground text-[13px] font-normal">
                      ({snapshot.actions.length})
                    </span>
                  </h3>
                  {snapshot.actions.length ? (
                    <ActionList actions={snapshot.actions} orgSlug={orgSlug} />
                  ) : (
                    <p className="text-muted-foreground text-[13px]">
                      No recommended actions in this analysis.
                    </p>
                  )}
                </div>
              </div>
            </ReportSection>
          ) : null}

          <ReportSection id="who-wrote-it" title="Who wrote it">
            <p className="text-muted-foreground flex max-w-3xl items-start gap-1.5 text-[13px]">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {reportWriterSentences(snapshot.analysis, timeZone).join(' ')} Every number was
                computed by Scopie and frozen when the report was made. Findings show what the
                numbers have in common, not what caused them.
              </span>
            </p>
          </ReportSection>

          <ReportSection
            id="notes"
            title="What this report couldn’t include"
            empty={snapshot.notes.length ? undefined : null}
          >
            <ul className="text-muted-foreground max-w-3xl list-disc space-y-1 pl-5 text-[13px]">
              {snapshot.notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          </ReportSection>

          <p className="text-muted-foreground text-xs">Dates and times in {timeZone}.</p>
        </>
      ) : (
        <div className="bg-card rounded-lg border border-dashed px-6 py-12 text-center">
          <p className="font-medium">
            {result.status === 'newer'
              ? 'This report was made by a newer version of Scopie'
              : 'This report can’t be shown'}
          </p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-[13px]">
            {result.status === 'newer'
              ? 'This version can’t read it yet. Reload the page in a few minutes; if it still shows this message, contact your administrator.'
              : 'Its stored contents couldn’t be read, so nothing is shown rather than numbers that might be wrong.'}
          </p>
        </div>
      )}
    </div>
  );
}

/** Two rankings side by side on wide screens; a single one gets the full width. */
function rankingGrid(count: number) {
  return count > 1 ? 'grid gap-4 xl:grid-cols-2' : 'grid gap-4';
}
