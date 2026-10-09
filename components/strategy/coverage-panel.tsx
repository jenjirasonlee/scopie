import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  MIN_ITEMS_FOR_SHARES,
  ON_TARGET_POINTS,
  type Coverage,
  type CoverageVerdict,
} from '@/lib/strategy/coverage';
import { measureStrategy, type StrategyForMeasure } from '@/lib/strategy/measure';
import { pillarColorClass } from '@/lib/taxonomy/shared';
import { cn } from '@/lib/utils';
import { ProgressCard } from './progress-panel';

/** Loads once, then shows pillar coverage and objective progress for a strategy. */
export async function StrategyMeasuresPanel({
  orgId,
  orgSlug,
  isDemoOrg,
  timeZone,
  strategy,
}: {
  orgId: string;
  orgSlug: string;
  isDemoOrg: boolean;
  timeZone: string;
  strategy: StrategyForMeasure;
}) {
  const { coverage, progress } = await measureStrategy({ orgId, isDemoOrg, timeZone, strategy });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CoverageCard
        coverage={coverage}
        orgSlug={orgSlug}
        hasTargets={strategy.pillars.length > 0}
      />
      <ProgressCard progress={progress} />
    </div>
  );
}

const VERDICT: Record<
  CoverageVerdict,
  { label: string; variant: 'success' | 'warning' | 'outline' }
> = {
  on_target: { label: 'On target', variant: 'success' },
  under: { label: 'Under target', variant: 'warning' },
  over: { label: 'Over target', variant: 'warning' },
  no_target: { label: 'No target', variant: 'outline' },
};

const pct = (value: number) => `${Math.round(value)}%`;

export function CoverageCard({
  coverage,
  orgSlug,
  hasTargets,
}: {
  coverage: Coverage;
  orgSlug: string;
  hasTargets: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pillar coverage</CardTitle>
        <CardDescription>
          Content planned or published in this strategy’s period, markets and platforms, by pillar.
          Archived and rejected content isn’t counted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {coverage.total === 0 ? (
          <p className="text-muted-foreground text-[13px]">
            No content is planned for this period yet. Give content a publish date in the{' '}
            <a href={`/${orgSlug}/content`} className="underline">
              content list
            </a>{' '}
            and it counts here.
          </p>
        ) : (
          <>
            <p className="text-[13px]">
              {coverage.total} {coverage.total === 1 ? 'item' : 'items'}: {coverage.published}{' '}
              published, {coverage.planned} planned.
            </p>
            {!coverage.comparable ? (
              <p className="text-muted-foreground text-xs">
                Shares are compared with targets from {MIN_ITEMS_FOR_SHARES} items; with fewer, one
                item moves them too much.
              </p>
            ) : null}
            <ul className="space-y-3">
              {coverage.rows.map((row) => (
                <li key={row.pillarId ?? 'none'} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        aria-hidden
                        className={cn('size-2 shrink-0 rounded-full', pillarColorClass(row.color))}
                      />
                      <span className="truncate font-medium">{row.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 tabular-nums">
                      <span>
                        {row.share === null ? '–' : pct(row.share)}
                        {row.targetShare !== null ? (
                          <span className="text-muted-foreground"> of {pct(row.targetShare)}</span>
                        ) : null}
                      </span>
                      {row.verdict ? (
                        <Badge variant={VERDICT[row.verdict].variant}>
                          {VERDICT[row.verdict].label}
                        </Badge>
                      ) : null}
                    </span>
                  </div>
                  <div className="bg-muted relative h-2 overflow-hidden rounded-full">
                    <div
                      className={cn('h-full rounded-full', pillarColorClass(row.color))}
                      style={{ width: `${Math.min(100, row.share ?? 0)}%` }}
                    />
                    {row.targetShare !== null ? (
                      <div
                        aria-hidden
                        className="bg-foreground absolute top-0 h-full w-0.5"
                        style={{ left: `${Math.min(100, row.targetShare)}%` }}
                      />
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {row.published} published, {row.planned} planned
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-xs">
              {hasTargets
                ? `The line marks the target. Within ${ON_TARGET_POINTS} points counts as on target.`
                : 'This strategy has no pillar targets yet.'}
              {hasTargets && coverage.targetTotal < 100
                ? ` Targets add up to ${pct(coverage.targetTotal)}.`
                : ''}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
