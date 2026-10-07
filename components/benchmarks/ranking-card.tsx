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
  formatBenchmarkValue,
  type ExcludedEntry,
  type Ranking,
} from '@/lib/analytics/benchmark';
import { platformName } from '@/lib/analytics/names';

/** The ranking, its basis sentence, and every profile that wasn't ranked, with the reason. */
export function RankingCard({
  ranking,
  orgSlug,
  note,
}: {
  ranking: Ranking;
  orgSlug: string;
  note?: string | null;
}) {
  const info = BENCHMARK_METRIC_INFO[ranking.metric];
  const values = ranking.ranked.map((r) => r.value);
  const maxAbs = Math.max(0, ...values.map(Math.abs));
  const diverging = values.some((v) => v < 0);
  const unavailable = ranking.excluded.filter((e) => e.reason !== 'other_platform');
  const otherPlatform = ranking.excluded.filter((e) => e.reason === 'other_platform');

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            Ranking: {info.label.toLowerCase()} on {platformName(ranking.platformKey)}
          </CardTitle>
          <SourceBadges sources={[ranking.source]} />
        </div>
        <CardDescription>
          <span className="text-foreground font-medium">{ranking.basis}</span> {info.help}
          {note ? ` ${note}` : ''}
        </CardDescription>
      </CardHeader>
      {ranking.ranked.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-right">#</TableHead>
              <TableHead>Profile</TableHead>
              <TableHead className="text-right">{info.label}</TableHead>
              <TableHead className="hidden w-40 md:table-cell">
                <span className="sr-only">Bar</span>
              </TableHead>
              <TableHead>Based on</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranking.ranked.map((entry) => (
              <TableRow key={entry.profile.id}>
                <TableCell className="text-muted-foreground text-right tabular-nums">
                  {entry.rank}
                </TableCell>
                <TableCell className="max-w-64">
                  <ProfileLink orgSlug={orgSlug} profile={entry.profile} showRole />
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatBenchmarkValue(ranking.metric, entry.value)}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Bar value={entry.value} maxAbs={maxAbs} diverging={diverging} />
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {entry.measurement.sample}
                  {entry.measurement.sampleUnit !== 'observation' ? (
                    <span className="block">
                      {entry.measurement.sampleSize} {entry.measurement.sampleUnit}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <SourceBadges sources={entry.measurement.sources} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <SectionEmpty>
          No profile in this set has a comparable value for this period yet. Scopie only ranks what
          it has observed; profiles without a value are listed below with the reason.
        </SectionEmpty>
      )}
      {unavailable.length ? (
        <ExcludedList title="Not ranked" entries={unavailable} orgSlug={orgSlug} />
      ) : null}
      {otherPlatform.length ? (
        <ExcludedList
          title={`On other platforms (not compared with ${platformName(ranking.platformKey)})`}
          entries={otherPlatform}
          orgSlug={orgSlug}
          collapsed
        />
      ) : null}
    </Card>
  );
}

function ExcludedList({
  title,
  entries,
  orgSlug,
  collapsed = false,
}: {
  title: string;
  entries: ExcludedEntry[];
  orgSlug: string;
  collapsed?: boolean;
}) {
  const list = (
    <ul className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
      {entries.map((entry) => (
        <li key={entry.profile.id} className="flex min-w-0 items-center justify-between gap-3">
          <ProfileLink orgSlug={orgSlug} profile={entry.profile} />
          <span className="shrink-0 cursor-help" title={entry.detail}>
            <Missing label={entry.label} />
            <span className="sr-only">: {entry.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
  if (collapsed) {
    return (
      <details className="border-t px-5 py-3">
        <summary className="cursor-pointer text-xs font-semibold">
          {title} ({entries.length})
        </summary>
        {list}
      </details>
    );
  }
  return (
    <div className="border-t px-5 py-3">
      <h4 className="text-xs font-semibold">
        {title} ({entries.length})
      </h4>
      {list}
    </div>
  );
}

/** A small bar next to each value; from a centre line when some values are negative. */
function Bar({ value, maxAbs, diverging }: { value: number; maxAbs: number; diverging: boolean }) {
  if (maxAbs <= 0) return null;
  const share = Math.abs(value) / maxAbs;
  if (!diverging) {
    return (
      <div aria-hidden className="bg-muted h-2 w-full rounded-sm">
        <div className="bg-primary/70 h-2 rounded-sm" style={{ width: `${share * 100}%` }} />
      </div>
    );
  }
  return (
    <div aria-hidden className="bg-muted relative h-2 w-full rounded-sm">
      <div className="bg-border absolute top-[-2px] bottom-[-2px] left-1/2 w-px" />
      <div
        className={`absolute top-0 h-2 rounded-sm ${value < 0 ? 'bg-destructive/60' : 'bg-primary/70'}`}
        style={
          value < 0
            ? { right: '50%', width: `${share * 50}%` }
            : { left: '50%', width: `${share * 50}%` }
        }
      />
    </div>
  );
}
