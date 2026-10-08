import 'server-only';
import { loadBenchmarkData } from '@/lib/analytics/queries';
import { DAY_MS } from '@/lib/analytics/range';
import { createClient } from '@/lib/db/server';
import {
  computeCoverage,
  strategyPeriod,
  type Coverage,
  type CoverageItem,
  type PillarTarget,
  type StrategyScope,
} from './coverage';
import { measureObjective, type ObjectiveInput, type ObjectiveProgress } from './progress';

/** What coverage and progress need to know about a strategy. */
export type StrategyForMeasure = StrategyScope & {
  pillars: readonly PillarTarget[];
  objectives: readonly ObjectiveInput[];
};

export type StrategyMeasures = {
  coverage: Coverage;
  progress: { objective: ObjectiveInput; result: ObjectiveProgress }[];
};

/** Coverage and objective progress for one strategy, from stored content and observations. */
export async function measureStrategy(input: {
  orgId: string;
  isDemoOrg: boolean;
  timeZone: string;
  strategy: StrategyForMeasure;
  now?: Date;
}): Promise<StrategyMeasures> {
  const now = input.now ?? new Date();
  const { strategy, timeZone } = input;
  const period = strategyPeriod(strategy, timeZone);
  const from = period.start.toISOString();
  const to = period.end.toISOString();
  const supabase = await createClient();

  const [items, pillarRows] = await Promise.all([
    supabase
      .from('content_items')
      .select(
        'id, status, pillar_id, country_code, platform_keys, planned_publish_at, published_at',
      )
      .eq('organization_id', input.orgId)
      .or(
        `and(planned_publish_at.gte.${from},planned_publish_at.lt.${to}),and(published_at.gte.${from},published_at.lt.${to})`,
      ),
    supabase.from('content_pillars').select('id, name, color').eq('organization_id', input.orgId),
  ]);
  if (items.error) throw items.error;
  if (pillarRows.error) throw pillarRows.error;
  const coverageItems: CoverageItem[] = items.data.map((row) => ({
    id: row.id,
    status: row.status,
    pillarId: row.pillar_id,
    countryCode: row.country_code,
    platformKeys: row.platform_keys,
    plannedPublishAt: row.planned_publish_at,
    publishedAt: row.published_at,
  }));

  const coverage = computeCoverage({
    items: coverageItems,
    scope: strategy,
    pillars: strategy.pillars,
    pillarNames: new Map(pillarRows.data.map((p) => [p.id, { name: p.name, color: p.color }])),
    timeZone,
  });

  // Observations are only loaded when an objective is measured from them and the period
  // has started; the window reaches back to the start of the strategy period.
  const needsObservations =
    now > period.start &&
    strategy.objectives.some((o) => o.kpi === 'posts_per_week' || o.kpi === 'follower_growth');
  let profiles: Parameters<typeof measureObjective>[0]['profiles'] = [];
  if (needsObservations) {
    const daysBack = Math.ceil((now.getTime() - period.start.getTime()) / DAY_MS) + 1;
    const data = await loadBenchmarkData({
      orgId: input.orgId,
      isDemoOrg: input.isDemoOrg,
      days: Math.max(1, Math.ceil(daysBack / 2) + 1),
      now,
    });
    profiles = [...data.data.values()];
  }

  return {
    coverage,
    progress: strategy.objectives.map((objective) => ({
      objective,
      result: measureObjective({
        objective,
        scope: strategy,
        timeZone,
        now,
        items: coverageItems,
        profiles,
      }),
    })),
  };
}
