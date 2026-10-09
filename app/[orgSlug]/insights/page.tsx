import { Info, MessagesSquare, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  InsightCard,
  RecommendationCard,
  RecommendationTabs,
} from '@/components/insights/insight-cards';
import { RunAnalysisForm } from '@/components/insights/insight-forms';
import { DataSourceBadge } from '@/components/pipeline/data-source-badge';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { runAnalysisAction } from '@/lib/ai/actions';
import {
  countRecommendations,
  getLatestRun,
  getProfileNames,
  getSignalPaths,
  listInsights,
  listRecentRuns,
  listRecommendations,
} from '@/lib/ai/queries';
import { analysisSetup } from '@/lib/ai/run';
import {
  formatPeriod,
  parseRecommendationTab,
  RECOMMENDATION_TAB_EMPTY,
  writerSentence,
} from '@/lib/ai/shared';
import { can } from '@/lib/auth/permissions';
import { formatDateTime } from '@/lib/content/review';
import { getOrgContext } from '@/lib/orgs/queries';

export const metadata: Metadata = { title: 'AI Insights' };

export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug }, search] = await Promise.all([params, searchParams]);
  const tab = parseRecommendationTab(Array.isArray(search.tab) ? search.tab[0] : search.tab);
  const { org, role } = await getOrgContext(orgSlug);
  const canRun = can(role, 'strategy.manage');
  const canAct = can(role, 'content.edit');
  const timeZone = org.default_timezone;

  const [latest, recommendations, counts, recentRuns] = await Promise.all([
    getLatestRun(org.id),
    listRecommendations(org.id, tab),
    countRecommendations(org.id),
    listRecentRuns(org.id),
  ]);
  const insights = latest ? await listInsights(org.id, latest.id) : [];

  const accountIds = [
    ...insights.flatMap((i) => i.evidence.flatMap((e) => e.accountIds)),
    ...recommendations.flatMap((r) => [
      ...r.evidence.flatMap((e) => e.accountIds),
      ...(r.experiment?.accountIds ?? []),
    ]),
  ];
  const [names, recSignalPaths] = await Promise.all([
    getProfileNames(org.id, accountIds),
    getSignalPaths(
      org.id,
      recommendations.map((r) => r.runId).filter((id) => id !== latest?.id),
    ),
  ]);
  if (latest) recSignalPaths.set(latest.id, latest.signalPaths);

  // Only read the server's setup when someone could use the button.
  const setup = canRun ? analysisSetup() : null;
  const hasAnyRecommendation = Object.values(counts).some((count) => count > 0);
  const when = (iso: string) => formatDateTime(iso, timeZone);
  const period = latest ? formatPeriod(latest.periodStart, latest.periodEnd, timeZone) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Insights"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {org.is_demo ? <Badge variant="demo">Demo</Badge> : null}
            <span>
              {org.is_demo
                ? 'What stands out in this DEMO DATA, with the numbers behind it and what you could try next. None of it is real.'
                : 'What stands out in your own data, with the numbers behind it and what you could try next.'}
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-start gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/${orgSlug}/insights/chat`}>
                <MessagesSquare aria-hidden />
                Ask Scopie
              </Link>
            </Button>
            {setup ? (
              setup.canRun ? (
                <RunAnalysisForm
                  action={runAnalysisAction.bind(null, orgSlug)}
                  label={latest ? 'Run analysis again' : 'Run analysis'}
                />
              ) : (
                <p className="text-muted-foreground max-w-xs text-xs">
                  Analysis can’t run yet. The server is missing: {setup.missing.join(', ')}.
                </p>
              )
            ) : null}
          </div>
        }
      />

      {latest ? (
        <Card>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-medium">{period ? `Covers ${period}` : 'Latest analysis'}</span>
              <DataSourceBadge source={latest.dataSource} />
              <span className="text-muted-foreground">
                Run {when(latest.createdAt)}
                {latest.createdByName ? ` by ${latest.createdByName}` : ''}
              </span>
            </div>
            <p className="text-muted-foreground flex items-start gap-1.5 text-[13px]">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {writerSentence(latest.writer, latest.model)} Findings show what the numbers have in
                common, not what caused them.
              </span>
            </p>
            {canRun && latest.rejected.length ? (
              <details className="text-xs">
                <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer font-medium select-none">
                  {latest.rejected.length} {latest.rejected.length === 1 ? 'finding' : 'findings'}{' '}
                  left out by the checks
                </summary>
                <ul className="mt-2 space-y-1.5 rounded-md border px-3 py-2">
                  {latest.rejected.map((item, index) => (
                    <li key={index}>
                      <span className="font-medium">{item.what}</span>
                      <span className="text-muted-foreground"> · {item.reason}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-3 py-10 text-center">
            <div className="bg-muted text-muted-foreground mx-auto flex size-10 items-center justify-center rounded-md">
              <Sparkles className="size-5" aria-hidden />
            </div>
            <h2 className="text-base font-semibold">No analysis yet</h2>
            <p className="text-muted-foreground mx-auto max-w-lg text-[13px]">
              An analysis looks at your profiles’ recent posts and growth, picks out what stands
              out, and suggests what to try next. Every finding shows the numbers it’s based on.
            </p>
            <p className="text-muted-foreground text-[13px]">
              {canRun
                ? setup?.canRun
                  ? 'Use “Run analysis” above to make the first one.'
                  : 'Once the server is set up, you can run the first one here.'
                : 'Ask a manager, admin or owner to run the first one.'}
            </p>
          </CardContent>
        </Card>
      )}

      {latest ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">
            Insights{' '}
            <span className="text-muted-foreground text-[13px] font-normal">
              ({insights.length})
            </span>
          </h2>
          {insights.length ? (
            <ul className="grid gap-4 lg:grid-cols-2">
              {insights.map((insight) => (
                <li key={insight.id}>
                  <InsightCard
                    insight={insight}
                    orgSlug={orgSlug}
                    names={names}
                    timeZone={timeZone}
                    signalPaths={latest.signalPaths}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="bg-card text-muted-foreground rounded-lg border border-dashed px-6 py-8 text-center text-[13px]">
              Nothing stood out enough in this period to report. That usually means there were too
              few posts to compare, or nothing changed much.
            </p>
          )}
        </section>
      ) : null}

      {latest || hasAnyRecommendation ? (
        <section id="recommendations" className="scroll-mt-20 space-y-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">Recommendations</h2>
            <p className="text-muted-foreground text-[13px]">
              {canAct
                ? 'Turn one into a content idea, mark it done once you’ve acted on it, or dismiss it.'
                : 'Editors, managers, admins and owners can act on recommendations.'}
            </p>
          </div>
          <RecommendationTabs orgSlug={orgSlug} active={tab} counts={counts} />
          {recommendations.length ? (
            <ul className="space-y-4">
              {recommendations.map((rec) => (
                <li key={rec.id}>
                  <RecommendationCard
                    rec={rec}
                    orgSlug={orgSlug}
                    names={names}
                    timeZone={timeZone}
                    signalPaths={recSignalPaths.get(rec.runId)}
                    canAct={canAct}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className="bg-card rounded-lg border border-dashed px-6 py-10 text-center">
              <p className="text-muted-foreground mx-auto max-w-md text-[13px]">
                {RECOMMENDATION_TAB_EMPTY[tab]}
              </p>
            </div>
          )}
        </section>
      ) : null}

      {recentRuns.length > 1 || recentRuns.some((run) => run.status === 'failed') ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Previous runs</h2>
          <ul className="divide-y rounded-lg border text-[13px]">
            {recentRuns.map((run) => {
              const covers = formatPeriod(run.periodStart, run.periodEnd, timeZone);
              return (
                <li
                  key={run.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2"
                >
                  <span>
                    {when(run.createdAt)}
                    {run.createdByName ? (
                      <span className="text-muted-foreground"> · {run.createdByName}</span>
                    ) : null}
                    {covers ? (
                      <span className="text-muted-foreground"> · covers {covers}</span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {run.status === 'failed'
                      ? canRun && run.error
                        ? `Didn’t finish: ${run.error}`
                        : 'Didn’t finish'
                      : run.id === latest?.id
                        ? 'Shown above'
                        : run.writer === 'model'
                          ? `Worded by ${run.model ?? 'an AI model'}`
                          : 'Worded by Scopie’s rules'}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-muted-foreground text-xs">Times in {timeZone}.</p>
        </section>
      ) : null}
    </div>
  );
}
