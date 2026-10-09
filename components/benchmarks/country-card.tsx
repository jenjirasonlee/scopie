import { Missing, SectionEmpty, SourceBadges } from '@/components/dashboard/values';
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
  BENCHMARK_METRIC_INFO,
  formatBenchmarkValue,
  type BenchmarkMetric,
  type CountryRow,
  type Ranking,
} from '@/lib/analytics/benchmark';
import type { GroupSummary } from '@/lib/analytics/compare';
import { platformName } from '@/lib/analytics/names';

/** Country vs country: medians per country, own profiles and competitors side by side. */
export function CountryCard({
  ranking,
  rows,
  countryNames,
}: {
  ranking: Ranking;
  rows: CountryRow[];
  countryNames: Map<string, string>;
}) {
  const info = BENCHMARK_METRIC_INFO[ranking.metric];
  const withValues = rows.filter((r) => r.all.profiles > 0);
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Country vs country</CardTitle>
          <SourceBadges sources={[ranking.source]} />
        </div>
        <CardDescription>
          {info.label} per country: the median of the profiles in each country,{' '}
          {platformName(ranking.platformKey)} only, on the same values as the ranking. Medians keep
          one very large profile from dominating a country. The count under each number is how many
          profiles it rests on; with one or two profiles, read it as that profile, not as the
          country. This describes what was observed; it doesn’t explain why countries differ.
        </CardDescription>
      </CardHeader>
      {withValues.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Country</TableHead>
              <TableHead className="text-right">Own profiles</TableHead>
              <TableHead className="text-right">Competitors</TableHead>
              <TableHead className="text-right">All profiles</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.countryCode ?? 'none'}>
                <TableCell>
                  {row.countryCode
                    ? (countryNames.get(row.countryCode) ?? row.countryCode)
                    : 'No country set'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <SummaryCell summary={row.own} metric={ranking.metric} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <SummaryCell summary={row.competitors} metric={ranking.metric} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <SummaryCell summary={row.all} metric={ranking.metric} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <SectionEmpty>
          No country has a profile with a comparable value yet. Countries are compared on the
          ranking’s values, so they appear as soon as profiles are ranked.
        </SectionEmpty>
      )}
      <p className="text-muted-foreground border-t px-5 py-2.5 text-xs">
        “All profiles” also includes industry accounts, creators and other profiles in the set.
      </p>
    </Card>
  );
}

function SummaryCell({ summary, metric }: { summary: GroupSummary; metric: BenchmarkMetric }) {
  if (!summary.profiles && !summary.unavailable) {
    return <span className="text-muted-foreground text-xs">–</span>;
  }
  return (
    <>
      {summary.median !== null ? (
        formatBenchmarkValue(metric, summary.median)
      ) : (
        <Missing label="no values yet" />
      )}
      <span className="text-muted-foreground block text-xs">
        {summary.profiles} profile{summary.profiles === 1 ? '' : 's'}
        {summary.unavailable ? ` · ${summary.unavailable} without a value` : ''}
      </span>
    </>
  );
}
