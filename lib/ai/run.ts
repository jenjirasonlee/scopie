import 'server-only';
import { comparisonSource } from '@/lib/analytics/compare';
import { distinctNames } from '@/lib/analytics/names';
import { loadBenchmarkData } from '@/lib/analytics/queries';
import { periodsFor } from '@/lib/analytics/range';
import { createAdminClient } from '@/lib/db/admin';
import type { Json } from '@/lib/db/types';
import { serverEnv } from '@/lib/server-env';
import { measureStrategy } from '@/lib/strategy/measure';
import { getStrategy, listStrategies } from '@/lib/strategy/queries';
import { periodState, todayIn } from '@/lib/strategy/shared';
import { analyzeSignals, type AnalysisResult } from './analyze';
import { PROMPT_VERSION, type Rejection } from './model';
import { openAiProvider } from './providers/openai';
import { detectSignals, type SignalInput } from './signals';
import type { Signal } from './types';

// One analysis run: load the organization's stored data as the signed-in user (RLS
// applies), find signals, write insights and recommendations, and save them with the
// service role. Callers check the user's permission first.

/** Days in "this period"; signals compare it with the same number of days before. */
export const ANALYSIS_DAYS = 28;
const MIN_MINUTES_BETWEEN_RUNS = 2;
const DEFAULT_MODEL = 'gpt-4.1-mini';
const DEFAULT_MAX_MODEL_RUNS = 20;

export function analysisSetup(): {
  canRun: boolean;
  writer: 'rules' | 'model';
  model: string | null;
  missing: string[];
} {
  const env = serverEnv();
  const missing = env.SUPABASE_SERVICE_ROLE_KEY ? [] : ['Supabase service role key'];
  const model = env.OPENAI_API_KEY ? (env.AI_MODEL_INSIGHTS ?? DEFAULT_MODEL) : null;
  return { canRun: !missing.length, writer: model ? 'model' : 'rules', model, missing };
}

async function loadSignalInput(input: {
  orgId: string;
  isDemoOrg: boolean;
  timeZone: string;
  now: Date;
}): Promise<SignalInput> {
  const periods = periodsFor(input.now, ANALYSIS_DAYS);
  const data = await loadBenchmarkData({
    orgId: input.orgId,
    isDemoOrg: input.isDemoOrg,
    days: ANALYSIS_DAYS,
    now: input.now,
  });
  const today = todayIn(input.timeZone, input.now);
  const running = (await listStrategies(input.orgId)).filter(
    (s) => s.status === 'active' && periodState(s.periodStart, s.periodEnd, today) === 'running',
  );
  const strategies = [];
  for (const summary of running) {
    const strategy = await getStrategy(input.orgId, summary.id);
    if (!strategy?.pillars.length) continue;
    const { coverage } = await measureStrategy({
      orgId: input.orgId,
      isDemoOrg: input.isDemoOrg,
      timeZone: input.timeZone,
      now: input.now,
      strategy: { ...strategy, objectives: [] },
    });
    strategies.push({ id: strategy.id, name: strategy.name, coverage });
  }
  return {
    profiles: data.profiles,
    followers: new Map([...data.data].map(([id, d]) => [id, d.followers])),
    posts: new Map([...data.data].map(([id, d]) => [id, d.posts])),
    periods,
    names: distinctNames(data.profiles),
    strategies,
  };
}

const json = (value: unknown) => value as NonNullable<Json>;

export async function runAnalysis(input: {
  orgId: string;
  orgSlug: string;
  isDemoOrg: boolean;
  timeZone: string;
  userId: string;
  now?: Date;
}): Promise<{ status: 'ok'; runId: string } | { status: 'error'; message: string }> {
  const setup = analysisSetup();
  if (!setup.canRun) {
    return { status: 'error', message: `The server needs: ${setup.missing.join(', ')}.` };
  }
  const now = input.now ?? new Date();
  const admin = createAdminClient();
  const env = serverEnv();

  const { data: recent, error: recentError } = await admin
    .from('analysis_runs')
    .select('created_at, writer')
    .eq('organization_id', input.orgId)
    .gte('created_at', new Date(now.getTime() - 86_400_000).toISOString())
    .order('created_at', { ascending: false });
  if (recentError) return { status: 'error', message: 'Could not check earlier runs.' };
  const last = recent[0];
  if (last && now.getTime() - Date.parse(last.created_at) < MIN_MINUTES_BETWEEN_RUNS * 60_000) {
    return {
      status: 'error',
      message: `An analysis ran less than ${MIN_MINUTES_BETWEEN_RUNS} minutes ago. Try again in a moment.`,
    };
  }

  const notes: Rejection[] = [];
  let model: { provider: ReturnType<typeof openAiProvider>; name: string } | null = null;
  if (setup.model && env.OPENAI_API_KEY) {
    const limit = env.AI_MAX_RUNS_PER_DAY ?? DEFAULT_MAX_MODEL_RUNS;
    if (recent.filter((r) => r.writer === 'model').length >= limit) {
      notes.push({
        what: 'The model',
        reason: `The daily limit of ${limit} model runs was reached, so Scopie's rules wrote this run.`,
      });
    } else {
      model = { provider: openAiProvider(env.OPENAI_API_KEY), name: setup.model };
    }
  }

  const periods = periodsFor(now, ANALYSIS_DAYS);
  const base = {
    organization_id: input.orgId,
    period_start: periods.previous.start.toISOString(),
    period_end: periods.current.end.toISOString(),
    data_source: comparisonSource(input.isDemoOrg),
    created_by: input.userId,
  };

  let signals: Signal[];
  let result: AnalysisResult;
  try {
    signals = detectSignals(await loadSignalInput({ ...input, now }));
    result = await analyzeSignals({ signals, model });
  } catch (error) {
    console.error('analysis failed', error instanceof Error ? error.message : error);
    await admin.from('analysis_runs').insert({
      ...base,
      writer: 'rules',
      status: 'failed',
      error: 'Scopie could not read the data for this analysis.',
    });
    return { status: 'error', message: 'The analysis failed. Nothing was saved; try again later.' };
  }

  // A model run that failed as a whole is saved as written by the rules, with the reason.
  const modelFailed = result.generation?.error != null;
  const writer = model && !modelFailed ? 'model' : 'rules';
  const { data: run, error: runError } = await admin
    .from('analysis_runs')
    .insert({
      ...base,
      writer,
      provider: writer === 'model' ? model!.provider.id : null,
      model: writer === 'model' ? model!.name : null,
      prompt_version: writer === 'model' ? PROMPT_VERSION : null,
      status: 'succeeded',
      signals: json(signals),
      rejected: json([...notes, ...result.rejected]),
    })
    .select('id')
    .single();
  if (runError) return { status: 'error', message: 'Could not save the analysis.' };

  const saved = await saveResults(admin, {
    orgId: input.orgId,
    runId: run.id,
    signals,
    result,
    model,
  });
  if (!saved) {
    await admin.from('analysis_runs').delete().eq('id', run.id);
    return { status: 'error', message: 'Could not save the analysis.' };
  }
  return { status: 'ok', runId: run.id };
}

async function saveResults(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    orgId: string;
    runId: string;
    signals: readonly Signal[];
    result: AnalysisResult;
    model: { provider: { id: string }; name: string } | null;
  },
): Promise<boolean> {
  const { orgId, runId, result } = input;
  const evidenceOf = (ids: readonly string[]) =>
    json(input.signals.filter((s) => ids.includes(s.id)).flatMap((s) => s.evidence));

  if (result.generation && input.model) {
    const { generation } = result;
    const { error } = await admin.from('ai_generations').insert({
      organization_id: orgId,
      run_id: runId,
      purpose: 'insights',
      provider: input.model.provider.id,
      model: input.model.name,
      prompt_version: PROMPT_VERSION,
      input: json(generation.input),
      output: json(generation.output ?? null),
      error: generation.error,
      input_tokens: generation.usage.inputTokens,
      output_tokens: generation.usage.outputTokens,
      duration_ms: generation.durationMs,
    });
    if (error) return false;
  }

  const insightIds = new Map<string, string>();
  if (result.insights.length) {
    const { data, error } = await admin
      .from('ai_insights')
      .insert(
        result.insights.map((insight, position) => ({
          organization_id: orgId,
          run_id: runId,
          kind: insight.kind,
          title: insight.title,
          body: insight.body,
          severity: insight.severity,
          signal_ids: insight.signalIds,
          evidence: evidenceOf(insight.signalIds),
          account_ids: insight.accountIds,
          position,
        })),
      )
      .select('id, signal_ids');
    if (error) return false;
    for (const row of data) insightIds.set(row.signal_ids[0]!, row.id);
  }

  if (result.recommendations.length) {
    const { error } = await admin.from('ai_recommendations').insert(
      result.recommendations.map((r, position) => ({
        organization_id: orgId,
        run_id: runId,
        insight_id: insightIds.get(r.insightSignalId) ?? null,
        title: r.title,
        observation: r.observation,
        recommendation: r.recommendation,
        expected_impact: r.expectedImpact,
        confidence: r.confidence,
        confidence_basis: r.confidenceBasis,
        signal_ids: r.signalIds,
        evidence: evidenceOf(r.signalIds),
        account_ids: r.accountIds,
        experiment: json(r.experiment),
        position,
      })),
    );
    if (error) return false;
  }
  return true;
}
