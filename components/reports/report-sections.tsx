import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { PlatformMark } from '@/components/accounts/platform-mark';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CONFIDENCE_LABELS,
  CONFIDENCE_VARIANT,
  insightKindLabel,
  SEVERITY_LABELS,
  SEVERITY_VARIANT,
} from '@/lib/ai/shared';
import { formatDay, RANKING_ROLE_LABELS, safeExternalUrl } from '@/lib/reports/shared';
import type {
  ReportAction,
  ReportInsight,
  ReportKpi,
  ReportPost,
  ReportRanking,
  ReportStrategy,
} from '@/lib/reports/types';
import { cn } from '@/lib/utils';

// The parts of a weekly report page. Everything is shown as stored in the snapshot.

/** A report section with a heading; one plain line instead of the body when it's empty. */
export function ReportSection({
  id,
  title,
  description,
  empty,
  children,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  /** Shown instead of the section's body; null hides the whole section. */
  empty?: string | null;
  children?: React.ReactNode;
}) {
  if (empty === null) return null;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 space-y-3">
      <div className="space-y-1">
        <h2 id={`${id}-title`} className="text-base font-semibold">
          {title}
        </h2>
        {description ? <p className="text-muted-foreground text-[13px]">{description}</p> : null}
      </div>
      {empty ? <p className="text-muted-foreground text-[13px]">{empty}</p> : children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export function KpiTiles({ kpis }: { kpis: ReportKpi[] }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 print:grid-cols-3">
      {kpis.map((kpi) => (
        <li
          key={kpi.key}
          className="bg-card space-y-1.5 rounded-lg border p-4 print:break-inside-avoid"
          title={kpi.basis || undefined}
        >
          <p className="text-muted-foreground text-xs font-medium">{kpi.label}</p>
          {kpi.value === null ? (
            <>
              <p className="text-muted-foreground text-xl font-semibold">N/A</p>
              <p className="text-muted-foreground text-xs italic">
                {kpi.unavailable ?? 'Not available for this week.'}
              </p>
            </>
          ) : (
            <>
              <p className="text-xl font-semibold tabular-nums">{kpi.display}</p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {kpi.change ??
                  (kpi.previous === null
                    ? 'No comparison: the week before isn’t known.'
                    : `Week before: ${kpi.previousDisplay}`)}
              </p>
            </>
          )}
          {kpi.basis ? (
            <p className="text-muted-foreground border-t pt-1.5 text-[11px] leading-snug">
              {kpi.basis}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Rankings
// ---------------------------------------------------------------------------

/** One platform's ranking by follower growth, with its basis and who wasn't ranked. */
export function RankingTable({
  ranking,
  orgSlug,
  showRole = false,
}: {
  ranking: ReportRanking;
  orgSlug: string;
  showRole?: boolean;
}) {
  return (
    <Card className="min-w-0 print:break-inside-avoid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlatformMark platformKey={ranking.platformKey} />
          {ranking.platform}
        </CardTitle>
        {ranking.basis ? (
          <CardDescription className="text-foreground">{ranking.basis}</CardDescription>
        ) : null}
      </CardHeader>
      {ranking.rows.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-right">#</TableHead>
              <TableHead>Profile</TableHead>
              {showRole ? <TableHead>Role</TableHead> : null}
              <TableHead className="text-right">Follower growth</TableHead>
              <TableHead>Based on</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranking.rows.map((row) => (
              <TableRow
                key={`${row.accountId}-${row.rank}`}
                className={cn(showRole && row.role === 'own' && 'bg-primary/5')}
              >
                <TableCell className="text-muted-foreground text-right tabular-nums">
                  {row.rank}
                </TableCell>
                <TableCell className="max-w-64">
                  <Link
                    href={`/${orgSlug}/accounts/${row.accountId}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {row.name}
                  </Link>
                  {row.countryCode ? (
                    <span className="text-muted-foreground block text-xs">{row.countryCode}</span>
                  ) : null}
                </TableCell>
                {showRole ? (
                  <TableCell>
                    <Badge variant={row.role === 'own' ? 'secondary' : 'outline'}>
                      {RANKING_ROLE_LABELS[row.role]}
                    </Badge>
                  </TableCell>
                ) : null}
                <TableCell className="text-right font-medium tabular-nums">{row.display}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{row.sample}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground px-5 py-4 text-[13px]">
          No profile on {ranking.platform} had a comparable value this week.
        </p>
      )}
      {ranking.notRanked.length ? (
        <div className="border-t px-5 py-3">
          <h3 className="text-xs font-semibold">Not ranked ({ranking.notRanked.length})</h3>
          <ul className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
            {ranking.notRanked.map((entry, index) => (
              <li key={`${entry.name}-${index}`} className="min-w-0 break-words">
                <span className="font-medium">{entry.name}</span>
                <span className="text-muted-foreground italic">: {entry.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Top content
// ---------------------------------------------------------------------------

export function TopContentTable({
  posts,
  orgSlug,
  timeZone,
}: {
  posts: ReportPost[];
  orgSlug: string;
  timeZone: string;
}) {
  return (
    <div className="bg-card rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-right">#</TableHead>
            <TableHead>Profile</TableHead>
            <TableHead>Platform</TableHead>
            <TableHead>Format</TableHead>
            <TableHead>Published</TableHead>
            <TableHead className="text-right">Engagement</TableHead>
            <TableHead className="print:hidden">
              <span className="sr-only">Post</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {posts.map((post, index) => {
            const url = safeExternalUrl(post.permalink);
            return (
              <TableRow key={`${post.accountId}-${post.publishedAt}-${index}`}>
                <TableCell className="text-muted-foreground text-right tabular-nums">
                  {index + 1}
                </TableCell>
                <TableCell className="max-w-56">
                  <Link
                    href={`/${orgSlug}/accounts/${post.accountId}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {post.profile}
                  </Link>
                </TableCell>
                <TableCell className="text-[13px]">{post.platform}</TableCell>
                <TableCell className="text-[13px]">{post.format}</TableCell>
                <TableCell className="text-[13px] whitespace-nowrap tabular-nums">
                  {formatDay(post.publishedAt, timeZone) ?? (
                    <span className="text-muted-foreground text-xs italic">date not known</span>
                  )}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {post.display}
                </TableCell>
                <TableCell className="print:hidden">
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap hover:underline"
                    >
                      View post
                      <ExternalLink className="size-3" aria-hidden />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  ) : (
                    <span className="text-muted-foreground text-xs italic">no link</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

export function StrategyList({
  strategies,
  orgSlug,
}: {
  strategies: ReportStrategy[];
  orgSlug: string;
}) {
  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {strategies.map((strategy) => (
        <li
          key={strategy.id}
          className="bg-card space-y-3 rounded-lg border p-4 print:break-inside-avoid"
        >
          <h3 className="text-sm font-semibold">
            <Link href={`/${orgSlug}/strategy/${strategy.id}`} className="hover:underline">
              {strategy.name}
            </Link>
          </h3>
          {strategy.objectives.length ? (
            <ul className="divide-y text-[13px]">
              {strategy.objectives.map((objective, index) => (
                <li key={`${objective.name}-${index}`} className="py-1.5 first:pt-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span>{objective.name}</span>
                    <span className="font-medium tabular-nums">{objective.display}</span>
                  </div>
                  {objective.note ? (
                    <p className="text-muted-foreground text-xs">{objective.note}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-[13px]">No objectives with a KPI.</p>
          )}
          {strategy.coverage ? (
            <p className="text-muted-foreground border-t pt-2 text-xs">{strategy.coverage}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Insights and actions
// ---------------------------------------------------------------------------

export function InsightGroup({
  title,
  insights,
  empty,
}: {
  title: string;
  insights: ReportInsight[];
  empty: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        {title}{' '}
        <span className="text-muted-foreground text-[13px] font-normal">({insights.length})</span>
      </h3>
      {insights.length ? (
        <ul className="grid gap-3 lg:grid-cols-2">
          {insights.map((insight) => (
            <li
              key={insight.id}
              className="bg-card space-y-1.5 rounded-lg border p-4 print:break-inside-avoid"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={SEVERITY_VARIANT[insight.severity]}>
                  {SEVERITY_LABELS[insight.severity]}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {insightKindLabel(insight.kind)}
                </span>
              </div>
              <h4 className="text-sm font-semibold">{insight.title}</h4>
              <p className="text-[13px] leading-relaxed whitespace-pre-line">{insight.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-[13px]">{empty}</p>
      )}
    </div>
  );
}

export function ActionList({ actions, orgSlug }: { actions: ReportAction[]; orgSlug: string }) {
  return (
    <ol className="space-y-3">
      {actions.map((action) => (
        <li
          key={action.id}
          className="bg-card space-y-1.5 rounded-lg border p-4 print:break-inside-avoid"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h4 className="text-sm font-semibold">{action.title}</h4>
            <Badge variant={CONFIDENCE_VARIANT[action.confidence]}>
              {CONFIDENCE_LABELS[action.confidence]}
            </Badge>
          </div>
          <p className="text-[13px] leading-relaxed whitespace-pre-line">{action.recommendation}</p>
          <Link
            href={`/${orgSlug}/insights?tab=open#rec-${action.id}`}
            className="text-primary inline-block text-xs font-medium hover:underline print:hidden"
          >
            See the evidence in AI Insights
          </Link>
        </li>
      ))}
    </ol>
  );
}
