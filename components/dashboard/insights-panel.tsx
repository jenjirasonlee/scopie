import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { DataSourceBadge } from '@/components/pipeline/data-source-badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Insight } from '@/lib/analytics/insights';
import { formatPeriod } from '@/lib/analytics/range';
import type { Period } from '@/lib/analytics/types';
import { SectionEmpty } from './values';

/** "What changed?": rule-based statements, each with its evidence and a link to the data. */
export function InsightsPanel({
  insights,
  periods,
}: {
  insights: Insight[];
  periods: { current: Period; previous: Period };
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What changed?</CardTitle>
        <CardDescription>
          {formatPeriod(periods.current)} compared with {formatPeriod(periods.previous)}. Each
          statement describes stored observations; it doesn’t say why something happened.
          Comparisons of posts need at least 5 posts on each side.
        </CardDescription>
      </CardHeader>
      {insights.length ? (
        <ul className="divide-y">
          {insights.map((insight) => (
            <li key={insight.id} className="space-y-2 px-5 py-3.5">
              <p className="text-[13px] leading-relaxed">{insight.text}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                <DataSourceBadge source={insight.dataSource} />
                <dl className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                  {insight.evidence.map((item) => (
                    <div key={item.label} className="flex gap-1">
                      <dt>{item.label}:</dt>
                      <dd className="text-foreground tabular-nums">{item.value}</dd>
                    </div>
                  ))}
                </dl>
                {insight.external ? (
                  <a
                    href={insight.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary inline-flex items-center gap-0.5 font-medium hover:underline"
                  >
                    {insight.linkLabel}
                    <ArrowUpRight className="size-3" aria-hidden />
                  </a>
                ) : (
                  <Link href={insight.href} className="text-primary font-medium hover:underline">
                    {insight.linkLabel}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <SectionEmpty>
          Nothing to report yet. Statements appear once two periods of observations can be compared,
          for example two follower observations a day apart in each period, or 5 posts measured at 7
          days old on each side.
        </SectionEmpty>
      )}
    </Card>
  );
}
