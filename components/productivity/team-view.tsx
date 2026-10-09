import Link from 'next/link';
import { CoverageCard } from '@/components/strategy/coverage-panel';
import { ProgressCard } from '@/components/strategy/progress-panel';
import type { TeamProductivity } from '@/lib/productivity/queries';
import { timeSavedSentence, HOURS_PER_HAND_MADE_REPORT } from '@/lib/productivity/shared';
import { teamTiles } from '@/lib/productivity/tiles';
import { formatStrategyPeriod } from '@/lib/strategy/shared';
import { MetricTiles, Section } from './metric-tiles';

/** Whole-team workflow numbers. Counts only: no names, no per-person breakdowns. */
export function TeamView({
  team,
  orgSlug,
  comparisonLabel,
}: {
  team: TeamProductivity;
  orgSlug: string;
  comparisonLabel: string | null;
}) {
  const tiles = teamTiles(team, orgSlug);
  return (
    <div className="space-y-8">
      <Section
        id="output"
        title="Output"
        description="How much content moved through Scopie in this period."
      >
        <MetricTiles tiles={tiles.output} comparisonLabel={comparisonLabel} />
      </Section>

      <Section
        id="review"
        title="Review and approval"
        description="From the review decisions recorded on each content version. A round is one sending for review that got a decision."
      >
        <MetricTiles tiles={tiles.review} comparisonLabel={comparisonLabel} />
      </Section>

      <Section
        id="consistency"
        title="Publishing consistency"
        description="Only content marked published in Scopie counts."
      >
        <MetricTiles tiles={tiles.consistency} comparisonLabel={comparisonLabel} />
      </Section>

      <Section
        id="strategy"
        title="Strategy coverage"
        description="Active strategies that overlap this period, measured over each strategy’s own dates up to today, as on the strategy page."
      >
        {team.strategies.length ? (
          <div className="space-y-6">
            {team.strategies.map((s) => (
              <div key={s.id} className="space-y-3">
                <h3 className="text-sm font-semibold">
                  <Link href={`/${orgSlug}/strategy/${s.id}`} className="hover:underline">
                    {s.name}
                  </Link>
                  <span className="text-muted-foreground font-normal">
                    {' '}
                    · {formatStrategyPeriod(s.periodStart, s.periodEnd)}
                  </span>
                </h3>
                <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                  <CoverageCard
                    coverage={s.coverage}
                    orgSlug={orgSlug}
                    hasTargets={s.hasPillarTargets}
                  />
                  <ProgressCard progress={s.progress} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-[13px]">
            N/A: no active strategy overlaps this period.{' '}
            <Link href={`/${orgSlug}/strategy`} className="underline">
              See strategies
            </Link>
            .
          </p>
        )}
      </Section>

      <Section
        id="automation"
        title="Reports and analyses"
        description="Weekly reports and AI analyses made in this period."
      >
        <MetricTiles tiles={tiles.automation} comparisonLabel={comparisonLabel} />
        <p className="bg-muted/50 text-muted-foreground rounded-md border border-dashed px-3 py-2 text-[13px]">
          {timeSavedSentence(tiles.automaticReports)} The {HOURS_PER_HAND_MADE_REPORT}-hour figure
          is an assumption, not something Scopie measured.
        </p>
      </Section>
    </div>
  );
}
