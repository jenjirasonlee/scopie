import 'server-only';
import { listPlatforms } from '@/lib/accounts/queries';
import { createClient } from '@/lib/db/server';
import type { Enums } from '@/lib/db/types';
import {
  readEvidence,
  readExperiment,
  readRejected,
  readSignalPaths,
  RECOMMENDATION_TABS,
} from './shared';
import type {
  AnalysisWriter,
  Evidence,
  Experiment,
  InsightSeverity,
  RecommendationConfidence,
  RecommendationStatus,
} from './types';

// Reads for the AI Insights page. They run as the signed-in user, so Row Level Security
// decides what is visible; runs, insights and recommendations are written only by the server.

export type AnalysisRunSummary = {
  id: string;
  status: Enums<'analysis_run_status'>;
  writer: AnalysisWriter;
  model: string | null;
  dataSource: Enums<'data_source'>;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  createdByName: string | null;
  /** Only set on failed runs. */
  error: string | null;
};

export type AnalysisRun = AnalysisRunSummary & {
  rejected: { what: string; reason: string }[];
  /** Signal id → page with the data behind it (relative to the organization). */
  signalPaths: Map<string, string>;
};

export type Insight = {
  id: string;
  kind: string;
  title: string;
  body: string;
  severity: InsightSeverity;
  signalIds: string[];
  evidence: Evidence[];
  accountIds: string[];
};

export type Recommendation = {
  id: string;
  runId: string;
  title: string;
  observation: string;
  recommendation: string;
  expectedImpact: string;
  confidence: RecommendationConfidence;
  confidenceBasis: string;
  signalIds: string[];
  evidence: Evidence[];
  accountIds: string[];
  experiment: Experiment | null;
  status: RecommendationStatus;
  statusNote: string | null;
  statusChangedByName: string | null;
  statusChangedAt: string | null;
  createdAt: string;
  /** Content ideas made from it (normally one). */
  contentItems: { id: string; title: string; status: Enums<'content_status'> }[];
};

type ProfileRef = { full_name: string | null; email: string } | null;
const personName = (profile: ProfileRef) => profile?.full_name || profile?.email || null;

const RUN_FIELDS =
  'id, status, writer, model, data_source, period_start, period_end, created_at, error, creator:profiles!analysis_runs_created_by_fkey(full_name, email)';

function runSummary(row: {
  id: string;
  status: Enums<'analysis_run_status'>;
  writer: AnalysisWriter;
  model: string | null;
  data_source: Enums<'data_source'>;
  period_start: string;
  period_end: string;
  created_at: string;
  error: string | null;
  creator: ProfileRef;
}): AnalysisRunSummary {
  return {
    id: row.id,
    status: row.status,
    writer: row.writer,
    model: row.model,
    dataSource: row.data_source,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    createdAt: row.created_at,
    createdByName: personName(row.creator),
    error: row.status === 'failed' ? row.error : null,
  };
}

/** The most recent analysis that finished, or null when none has yet. */
export async function getLatestRun(orgId: string): Promise<AnalysisRun | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('analysis_runs')
    .select(`${RUN_FIELDS}, signals, rejected`)
    .eq('organization_id', orgId)
    .eq('status', 'succeeded')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...runSummary(data),
    rejected: readRejected(data.rejected),
    signalPaths: readSignalPaths(data.signals),
  };
}

/** The last few runs, newest first, including ones that failed. */
export async function listRecentRuns(orgId: string, limit = 5): Promise<AnalysisRunSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('analysis_runs')
    .select(RUN_FIELDS)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.map(runSummary);
}

/** A run's insights, in the order the analysis ranked them. */
export async function listInsights(orgId: string, runId: string): Promise<Insight[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ai_insights')
    .select('id, kind, title, body, severity, signal_ids, evidence, account_ids')
    .eq('organization_id', orgId)
    .eq('run_id', runId)
    .order('position')
    .limit(50);
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    severity: row.severity,
    signalIds: row.signal_ids,
    evidence: readEvidence(row.evidence),
    accountIds: row.account_ids,
  }));
}

/**
 * Recommendations with one status: newest analysis first, then in the order that analysis
 * ranked them. Each comes with the content ideas made from it.
 */
export async function listRecommendations(
  orgId: string,
  status: RecommendationStatus = 'open',
): Promise<Recommendation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ai_recommendations')
    .select(
      'id, run_id, title, observation, recommendation, expected_impact, confidence, confidence_basis, signal_ids, evidence, account_ids, experiment, position, status, status_note, status_changed_at, created_at, changer:profiles!ai_recommendations_status_changed_by_fkey(full_name, email), run:analysis_runs!inner(created_at)',
    )
    .eq('organization_id', orgId)
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;

  const ids = data.map((row) => row.id);
  const linked = new Map<string, Recommendation['contentItems']>();
  if (ids.length) {
    const { data: items, error: itemError } = await supabase
      .from('content_items')
      .select('id, title, status, source_recommendation_id')
      .eq('organization_id', orgId)
      .in('source_recommendation_id', ids)
      .order('created_at');
    if (itemError) throw itemError;
    for (const item of items) {
      const key = item.source_recommendation_id!;
      linked.set(key, [
        ...(linked.get(key) ?? []),
        { id: item.id, title: item.title, status: item.status },
      ]);
    }
  }

  return data
    .sort(
      (a, b) =>
        b.run.created_at.localeCompare(a.run.created_at) ||
        a.run_id.localeCompare(b.run_id) ||
        a.position - b.position,
    )
    .map((row) => ({
      id: row.id,
      runId: row.run_id,
      title: row.title,
      observation: row.observation,
      recommendation: row.recommendation,
      expectedImpact: row.expected_impact,
      confidence: row.confidence,
      confidenceBasis: row.confidence_basis,
      signalIds: row.signal_ids,
      evidence: readEvidence(row.evidence),
      accountIds: row.account_ids,
      experiment: readExperiment(row.experiment),
      status: row.status,
      statusNote: row.status_note,
      statusChangedByName: personName(row.changer),
      statusChangedAt: row.status_changed_at,
      createdAt: row.created_at,
      contentItems: linked.get(row.id) ?? [],
    }));
}

/** How many recommendations have each status. */
export async function countRecommendations(
  orgId: string,
): Promise<Record<RecommendationStatus, number>> {
  const supabase = await createClient();
  const results = await Promise.all(
    RECOMMENDATION_TABS.map((status) =>
      supabase
        .from('ai_recommendations')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('status', status),
    ),
  );
  const counts = {} as Record<RecommendationStatus, number>;
  results.forEach(({ count, error }, index) => {
    if (error) throw error;
    // A head request with an exact count always returns one.
    counts[RECOMMENDATION_TABS[index]!] = count ?? 0;
  });
  return counts;
}

/** Signal links for the runs behind a list of recommendations. */
export async function getSignalPaths(
  orgId: string,
  runIds: readonly string[],
): Promise<Map<string, Map<string, string>>> {
  const result = new Map<string, Map<string, string>>();
  const unique = [...new Set(runIds)];
  if (!unique.length) return result;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('analysis_runs')
    .select('id, signals')
    .eq('organization_id', orgId)
    .in('id', unique);
  if (error) throw error;
  for (const row of data) result.set(row.id, readSignalPaths(row.signals));
  return result;
}

/**
 * Profile names for the given ids: "Name (Platform)". Profiles that were deleted, or that
 * this member can't see, are missing from the map.
 */
export async function getProfileNames(
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!unique.length) return names;
  const supabase = await createClient();
  const [{ data, error }, platforms] = await Promise.all([
    supabase
      .from('social_accounts')
      .select('id, display_name, platform_key')
      .eq('organization_id', orgId)
      .in('id', unique.slice(0, 500)),
    listPlatforms(),
  ]);
  if (error) throw error;
  const platformName = new Map(platforms.map((p) => [p.key, p.name]));
  for (const row of data) {
    names.set(
      row.id,
      `${row.display_name} (${platformName.get(row.platform_key) ?? row.platform_key})`,
    );
  }
  return names;
}

/** One recommendation, for the actions. */
export async function getRecommendation(orgId: string, id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ai_recommendations')
    .select(
      'id, title, observation, recommendation, expected_impact, experiment, status, account_ids',
    )
    .eq('organization_id', orgId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** The recommendation a content item was created from, for a link back to it. */
export async function getSourceRecommendation(
  orgId: string,
  id: string,
): Promise<{ id: string; title: string; status: RecommendationStatus } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ai_recommendations')
    .select('id, title, status')
    .eq('organization_id', orgId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}
