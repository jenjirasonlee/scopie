import 'server-only';
import { formatDecimal } from '@/lib/analytics/format';
import { platformName } from '@/lib/analytics/names';
import { loadBenchmarkData } from '@/lib/analytics/queries';
import type { ServerClient } from '@/lib/db/server';
import { PLATFORM_METRIC_MAP } from '@/lib/metrics/registry';
import { measureStrategy } from '@/lib/strategy/measure';
import { getStrategy, listStrategies } from '@/lib/strategy/queries';
import {
  formatStrategyPeriod,
  periodState,
  STRATEGY_STATUS_LABELS,
  todayIn,
} from '@/lib/strategy/shared';
import type { ChatAnalysis, ChatBenchmark, ChatDataLoaders, ChatStrategy } from './tools';

// What the chat's tools read, loaded as the signed-in user: Row Level Security decides what
// is visible, and every query is scoped to the organization. Loaded once per question.

type Measures = Awaited<ReturnType<typeof measureStrategy>>;

function progressDisplay(result: Measures['progress'][number]['result']): {
  progress: string;
  note: string | null;
} {
  switch (result.status) {
    case 'measured':
      return {
        progress: `${formatDecimal(result.value)} of ${formatDecimal(result.target)}`,
        note: result.basis,
      };
    case 'manual':
      return {
        progress: result.target === null ? 'No target' : `Target ${formatDecimal(result.target)}`,
        note: 'Tracked outside Scopie.',
      };
    case 'not_started':
      return { progress: 'Not started', note: `Starts on ${result.startsOn}.` };
    case 'unavailable':
      return { progress: 'N/A', note: result.reason };
  }
}

export function chatLoaders(input: {
  orgId: string;
  isDemoOrg: boolean;
  timeZone: string;
  now: Date;
  db: ServerClient;
}): ChatDataLoaders {
  const { orgId, db } = input;
  const benchmarks = new Map<number, Promise<ChatBenchmark>>();

  return {
    benchmark(days) {
      let pending = benchmarks.get(days);
      if (!pending) {
        pending = loadBenchmarkData({
          orgId,
          isDemoOrg: input.isDemoOrg,
          days,
          now: input.now,
          db,
        }).then((data) => ({ profiles: data.profiles, data: data.data }));
        benchmarks.set(days, pending);
      }
      return pending;
    },

    async analysis(): Promise<ChatAnalysis | null> {
      const { data: run, error } = await db
        .from('analysis_runs')
        .select('id, writer, model, created_at, period_start, period_end')
        .eq('organization_id', orgId)
        .eq('status', 'succeeded')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!run) return null;
      const [insights, recommendations] = await Promise.all([
        db
          .from('ai_insights')
          .select('kind, title, body, severity')
          .eq('organization_id', orgId)
          .eq('run_id', run.id)
          .order('position'),
        db
          .from('ai_recommendations')
          .select('title, recommendation, confidence')
          .eq('organization_id', orgId)
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .order('position')
          .limit(10),
      ]);
      if (insights.error) throw insights.error;
      if (recommendations.error) throw recommendations.error;
      return {
        createdAt: run.created_at,
        periodStart: run.period_start,
        periodEnd: run.period_end,
        writer: run.writer,
        model: run.model,
        insights: insights.data,
        recommendations: recommendations.data,
      };
    },

    async strategies(): Promise<ChatStrategy[]> {
      const today = todayIn(input.timeZone, input.now);
      const running = (await listStrategies(orgId, db)).filter(
        (s) =>
          s.status === 'active' && periodState(s.periodStart, s.periodEnd, today) === 'running',
      );
      const out: ChatStrategy[] = [];
      for (const summary of running.slice(0, 5)) {
        const strategy = await getStrategy(orgId, summary.id, db);
        if (!strategy) continue;
        const { coverage, progress } = await measureStrategy({
          orgId,
          isDemoOrg: input.isDemoOrg,
          timeZone: input.timeZone,
          now: input.now,
          strategy,
          db,
        });
        const under = coverage.rows.filter((r) => r.verdict === 'under').map((r) => r.name);
        out.push({
          name: strategy.name,
          period: formatStrategyPeriod(strategy.periodStart, strategy.periodEnd),
          status: STRATEGY_STATUS_LABELS[strategy.status],
          objectives: progress.map(({ objective, result }) => ({
            name: objective.name,
            ...progressDisplay(result),
          })),
          coverage: !strategy.pillars.length
            ? 'No pillar targets set.'
            : !coverage.comparable
              ? `${coverage.total} content items so far; too few to compare with the pillar targets.`
              : under.length
                ? `${coverage.total} content items; under target: ${under.join(', ')}.`
                : `${coverage.total} content items; every pillar is on or over its target.`,
        });
      }
      return out;
    },

    async metric(key) {
      const { data, error } = await db
        .from('metric_definitions')
        .select('key, label, definition, unit, formula')
        .eq('key', key)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const platforms = [
        ...new Set(
          PLATFORM_METRIC_MAP.filter((m) => m.metricKey === key).map((m) =>
            platformName(m.platformKey),
          ),
        ),
      ];
      return { ...data, platforms };
    },

    async metricKeys() {
      const { data, error } = await db
        .from('metric_definitions')
        .select('key, label')
        .order('sort_order');
      if (error) throw error;
      return data;
    },
  };
}
