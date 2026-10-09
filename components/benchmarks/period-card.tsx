import { Missing, ProfileLink, SectionEmpty, SourceBadges } from '@/components/dashboard/values';
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
  engagementWindow,
  formatBenchmarkValue,
  formatDifference,
  type BenchmarkMetric,
  type Measurement,
  type PeriodGroupSummary,
  type PeriodRow,
} from '@/lib/analytics/benchmark';
import { formatSignedPercent } from '@/lib/analytics/format';
import { platformName } from '@/lib/analytics/names';
import { formatPeriod } from '@/lib/analytics/range';
import type { DataSource, Period } from '@/lib/analytics/types';

/** This period vs the previous period of equal length, per group and per profile. */
export function PeriodCard({
  metric,
  platformKey,
  source,
  periods,
  days,
  groups,
  rows,
  orgSlug,
}: {
  metric: BenchmarkMetric;
  platformKey: string;
  source: DataSource;
  periods: { current: Period; previous: Period };
  days: number;
  groups: PeriodGroupSummary[];
  rows: PeriodRow[];
  orgSlug: string;
}) {
  const info = BENCHMARK_METRIC_INFO[metric];
  const label = (period: Period) =>
    metric === 'median_engagement'
      ? `posts published ${formatPeriod(engagementWindow(period))}`
      : formatPeriod(period);
  const compared = rows.filter((r) => r.change.status === 'compared').length;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>This period vs the previous {days} days</CardTitle>
          <SourceBadges sources={[source]} />
        </div>
        <CardDescription>
          {info.label}, {platformName(platformKey)}: {label(periods.current)} compared with{' '}
          {label(periods.previous)}. Both values are shown with what they rest on. Where either
          period lacks observations the change isn’t given; nothing is filled in. Group medians use
          only profiles with a value in both periods.
        </CardDescription>
      </CardHeader>

      {groups.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Group</TableHead>
              <TableHead className="text-right">This period</TableHead>
              <TableHead className="text-right">Previous period</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">Profiles compared</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => {
              const both = group.currentMedian !== null && group.previousMedian !== null;
              return (
                <TableRow key={group.key}>
                  <TableCell className="font-medium">{group.label}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {group.currentMedian !== null ? (
                      `median ${formatBenchmarkValue(metric, group.currentMedian)}`
                    ) : (
                      <Missing label="not enough observations" />
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {group.previousMedian !== null ? (
                      `median ${formatBenchmarkValue(metric, group.previousMedian)}`
                    ) : (
                      <Missing label="not enough observations" />
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {both
                      ? formatDifference(metric, group.currentMedian! - group.previousMedian!)
                      : '–'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {group.paired} of {group.profiles}
                    {group.notEnough ? (
                      <span className="text-muted-foreground block text-xs">
                        {group.notEnough} without both periods
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}

      <h4 className="border-t px-5 pt-3 text-xs font-semibold">
        Per profile ({compared} of {rows.length} with both periods)
      </h4>
      {rows.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Profile</TableHead>
              <TableHead className="text-right">This period</TableHead>
              <TableHead className="text-right">Previous period</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const sources = new Set<DataSource>();
              for (const m of [row.current, row.previous]) {
                if (m.status === 'ok') for (const s of m.sources) sources.add(s);
              }
              return (
                <TableRow key={row.profile.id}>
                  <TableCell className="max-w-56">
                    <ProfileLink orgSlug={orgSlug} profile={row.profile} showRole />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Value metric={metric} measurement={row.current} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Value metric={metric} measurement={row.previous} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.change.status === 'compared' ? (
                      <>
                        {formatDifference(metric, row.change.difference)}
                        {row.change.relative !== null ? (
                          <span className="text-muted-foreground block text-xs">
                            {formatSignedPercent(row.change.relative)}
                          </span>
                        ) : null}
                      </>
                    ) : row.change.status === 'not_comparable' ? (
                      <Missing label="not comparable" />
                    ) : (
                      <Missing
                        label={
                          row.change.missing.length === 2
                            ? 'not enough observations'
                            : `not enough observations (${row.change.missing[0] === 'current' ? 'this' : 'previous'} period)`
                        }
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    {sources.size ? (
                      <SourceBadges sources={sources} />
                    ) : (
                      <SourceBadges sources={[source]} />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <SectionEmpty>No active profiles on this platform in this set.</SectionEmpty>
      )}
    </Card>
  );
}

function Value({ metric, measurement }: { metric: BenchmarkMetric; measurement: Measurement }) {
  if (measurement.status !== 'ok') {
    return <Missing result={measurement} label={measurement.label} />;
  }
  return (
    <>
      {formatBenchmarkValue(metric, measurement.value)}
      <span className="text-muted-foreground block text-xs">
        {measurement.sampleUnit === 'observation'
          ? measurement.sample
          : `${measurement.sampleSize} ${measurement.sampleUnit}`}
      </span>
    </>
  );
}
