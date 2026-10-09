import 'server-only';
import { comparisonSource } from '@/lib/analytics/compare';
import { ENGAGEMENT_AGE_DAYS } from '@/lib/analytics/engagement';
import { distinctNames } from '@/lib/analytics/names';
import { loadBenchmarkData } from '@/lib/analytics/queries';
import { DAY_MS } from '@/lib/analytics/range';
import { analysisSetup, runAnalysis } from '@/lib/ai/run';
import type { SignalKind } from '@/lib/ai/types';
import { createAdminClient } from '@/lib/db/admin';
import type { Json } from '@/lib/db/types';
import type { ServerClient } from '@/lib/db/server';
import { serverEnv } from '@/lib/server-env';
import { measureStrategy } from '@/lib/strategy/measure';
import { getStrategy, listStrategies } from '@/lib/strategy/queries';
import { periodState, todayIn } from '@/lib/strategy/shared';
import { buildWeeklySnapshot } from './build';
import { formatWeek } from './shared';
import type { ReportSnapshot, ReportStrategy, ReportWeek } from './types';
import { isoWeekday, lastFullWeek, localHour, previousWeek, weekPeriod } from './week';

// Makes one weekly report: loads the organization's stored data with the service role
// (every query is scoped to the organization), uses a fresh analysis for insights and
// actions, freezes it all in a snapshot, and tells the members. Used by the Monday job and
// by managers (whose permission the caller checks).

/** An analysis this recent is reused instead of running a new one. */
const REUSE_ANALYSIS_HOURS = 24;

export function reportSetup(): { canRun: boolean; missing: string[] } {
  const missing = serverEnv().SUPABASE_SERVICE_ROLE_KEY ? [] : ['Supabase service role key'];
  return { canRun: !missing.length, missing };
}

function objectiveDisplay(
  result: Awaited<ReturnType<typeof measureStrategy>>['progress'][number]['result'],
): { display: string; note: string | null } {
  const n = (value: number) => value.toLocaleString('en-GB', { maximumFractionDigits: 1 });
  switch (result.status) {
    case 'measured':
      return { display: `${n(result.value)} of ${n(result.target)}`, note: result.basis };
    case 'manual':
      return {
        display: result.target === null ? 'No target' : `Target ${n(result.target)}`,
        note: 'Tracked outside Scopie.',
      };
    case 'not_started':
      return { display: 'Not started', note: `Starts on ${result.startsOn}.` };
    case 'unavailable':
      return { display: 'N/A', note: result.reason };
  }
}

async function loadStrategies(
  db: ServerClient,
  org: { id: string; isDemo: boolean; timeZone: string },
  week: ReportWeek,
  asOf: Date,
): Promise<ReportStrategy[]> {
  const running = (await listStrategies(org.id, db)).filter(
    (s) => s.status === 'active' && periodState(s.periodStart, s.periodEnd, week.end) === 'running',
  );
  const out: ReportStrategy[] = [];
  for (const summary of running) {
    const strategy = await getStrategy(org.id, summary.id, db);
    if (!strategy) continue;
    const { coverage, progress } = await measureStrategy({
      orgId: org.id,
      isDemoOrg: org.isDemo,
      timeZone: org.timeZone,
      now: asOf,
      strategy,
      db,
    });
    const under = coverage.rows.filter((r) => r.verdict === 'under').map((r) => r.name);
    out.push({
      id: strategy.id,
      name: strategy.name,
      objectives: progress.map(({ objective, result }) => ({
        name: objective.name,
        ...objectiveDisplay(result),
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
}

async function loadAnalysis(
  admin: ReturnType<typeof createAdminClient>,
  org: { id: string; slug: string; isDemo: boolean; timeZone: string },
  now: Date,
): Promise<{ analysis: ReportSnapshotInputAnalysis; note: string | null }> {
  const fresh = await admin
    .from('analysis_runs')
    .select('id')
    .eq('organization_id', org.id)
    .eq('status', 'succeeded')
    .gte('created_at', new Date(now.getTime() - REUSE_ANALYSIS_HOURS * 3_600_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1);
  let runId = fresh.data?.[0]?.id ?? null;
  let note: string | null = null;
  if (!runId && analysisSetup().canRun) {
    const result = await runAnalysis({
      orgId: org.id,
      orgSlug: org.slug,
      isDemoOrg: org.isDemo,
      timeZone: org.timeZone,
      userId: null,
      now,
      db: admin as unknown as ServerClient,
    });
    if (result.status === 'ok') runId = result.runId;
    else note = `A new analysis couldn't be made (${result.message}).`;
  }
  if (!runId) return { analysis: null, note };

  const [run, insights, recommendations] = await Promise.all([
    admin
      .from('analysis_runs')
      .select('id, writer, model, created_at, period_start, period_end')
      .eq('id', runId)
      .single(),
    admin
      .from('ai_insights')
      .select('id, kind, title, body, severity')
      .eq('run_id', runId)
      .order('position'),
    admin
      .from('ai_recommendations')
      .select('id, title, recommendation, confidence')
      .eq('run_id', runId)
      .eq('status', 'open')
      .order('position'),
  ]);
  if (run.error || insights.error || recommendations.error) {
    return { analysis: null, note: "The analysis couldn't be read." };
  }
  return {
    note,
    analysis: {
      meta: {
        runId: run.data.id,
        writer: run.data.writer,
        model: run.data.model,
        createdAt: run.data.created_at,
        periodStart: run.data.period_start,
        periodEnd: run.data.period_end,
      },
      insights: insights.data.map((i) => ({ ...i, kind: i.kind as SignalKind })),
      actions: recommendations.data,
    },
  };
}

type ReportSnapshotInputAnalysis = Parameters<typeof buildWeeklySnapshot>[0]['analysis'];

async function countBetween(
  admin: ReturnType<typeof createAdminClient>,
  table: 'content_items' | 'content_reviews',
  column: 'published_at' | 'created_at',
  orgId: string,
  period: { start: Date; end: Date },
): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .gte(column, period.start.toISOString())
    .lt(column, period.end.toISOString());
  if (error) throw error;
  return count ?? 0;
}

export async function generateWeeklyReport(input: {
  orgId: string;
  userId: string | null;
  madeBy: 'schedule' | 'manual';
  now?: Date;
}): Promise<
  | { status: 'ok'; reportId: string }
  | { status: 'exists'; reportId: string }
  | { status: 'error'; message: string }
> {
  const setup = reportSetup();
  if (!setup.canRun) {
    return { status: 'error', message: `The server needs: ${setup.missing.join(', ')}.` };
  }
  const now = input.now ?? new Date();
  const admin = createAdminClient();
  const db = admin as unknown as ServerClient;

  const { data: orgRow, error: orgError } = await admin
    .from('organizations')
    .select('id, name, slug, is_demo, default_timezone')
    .eq('id', input.orgId)
    .single();
  if (orgError) return { status: 'error', message: 'Organization not found.' };
  const org = {
    id: orgRow.id,
    slug: orgRow.slug,
    isDemo: orgRow.is_demo,
    timeZone: orgRow.default_timezone,
  };

  const week = lastFullWeek(now, org.timeZone);
  const existing = await admin
    .from('reports')
    .select('id')
    .eq('organization_id', org.id)
    .eq('kind', 'weekly')
    .eq('period_start', week.start)
    .maybeSingle();
  if (existing.data) return { status: 'exists', reportId: existing.data.id };

  let snapshot: ReportSnapshot;
  let analysisRunId: string | null = null;
  try {
    const before = previousWeek(week);
    const period = weekPeriod(week, org.timeZone);
    const previousPeriod = weekPeriod(before, org.timeZone);
    // Enough history for the week before, and for posts measured 7 days after publishing.
    const oldest = previousPeriod.start.getTime() - ENGAGEMENT_AGE_DAYS * DAY_MS;
    const days = Math.ceil((now.getTime() - oldest) / DAY_MS / 2) + 1;
    const data = await loadBenchmarkData({ orgId: org.id, isDemoOrg: org.isDemo, days, now, db });
    const [published, previousPublished, reviews, previousReviews, strategies, analysis] =
      await Promise.all([
        countBetween(admin, 'content_items', 'published_at', org.id, period),
        countBetween(admin, 'content_items', 'published_at', org.id, previousPeriod),
        countBetween(admin, 'content_reviews', 'created_at', org.id, period),
        countBetween(admin, 'content_reviews', 'created_at', org.id, previousPeriod),
        loadStrategies(db, org, week, period.end),
        loadAnalysis(admin, org, now),
      ]);
    analysisRunId = analysis.analysis?.meta.runId ?? null;
    snapshot = buildWeeklySnapshot({
      orgName: orgRow.name,
      isDemo: org.isDemo,
      source: comparisonSource(org.isDemo),
      timeZone: org.timeZone,
      week,
      previousWeek: before,
      period,
      previousPeriod,
      profiles: data.profiles,
      data: data.data,
      names: distinctNames(data.profiles),
      content: { published, previousPublished, reviews, previousReviews },
      strategies,
      analysis: analysis.analysis,
      notes: analysis.note ? [analysis.note] : [],
    });
  } catch (error) {
    console.error('weekly report failed', error instanceof Error ? error.message : error);
    return {
      status: 'error',
      message: "The report couldn't be made. Nothing was saved; try again later.",
    };
  }

  const title = `Weekly report, ${formatWeek(week)}`;
  const { data: report, error } = await admin
    .from('reports')
    .insert({
      organization_id: org.id,
      kind: 'weekly',
      period_start: week.start,
      period_end: week.end,
      time_zone: org.timeZone,
      title,
      data_source: comparisonSource(org.isDemo),
      snapshot: snapshot as unknown as NonNullable<Json>,
      analysis_run_id: analysisRunId,
      made_by: input.madeBy,
      created_by: input.userId,
    })
    .select('id')
    .single();
  if (error) {
    // Another request made it first.
    if (error.code === '23505') {
      const again = await admin
        .from('reports')
        .select('id')
        .eq('organization_id', org.id)
        .eq('kind', 'weekly')
        .eq('period_start', week.start)
        .single();
      if (again.data) return { status: 'exists', reportId: again.data.id };
    }
    return { status: 'error', message: "The report couldn't be saved." };
  }

  const { data: members } = await admin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', org.id);
  if (members?.length) {
    await admin.from('notifications').insert(
      members.map((m) => ({
        organization_id: org.id,
        user_id: m.user_id,
        kind: 'report_ready',
        report_id: report.id,
        actor_id: input.userId,
        excerpt: title,
      })),
    );
  }
  return { status: 'ok', reportId: report.id };
}

/** Hour of the local Monday from which last week's report is made. */
export const REPORT_HOUR = 6;

/** Whether last week's report is due: from Monday 06:00 local time onwards. */
export function reportIsDue(now: Date, timeZone: string): boolean {
  return isoWeekday(todayIn(timeZone, now)) !== 1 || localHour(now, timeZone) >= REPORT_HOUR;
}

/**
 * Makes every report that is due and missing. Run hourly by the schedule; organizations in
 * every time zone get theirs soon after their own Monday 06:00, and a missed run catches up.
 */
export async function generateDueReports(now: Date = new Date()): Promise<{
  made: number;
  failed: number;
}> {
  const admin = createAdminClient();
  const { data: orgs, error } = await admin.from('organizations').select('id, default_timezone');
  if (error) throw new Error("Organizations couldn't be listed.");
  let made = 0;
  let failed = 0;
  for (const org of orgs) {
    if (!reportIsDue(now, org.default_timezone)) continue;
    const week = lastFullWeek(now, org.default_timezone);
    const { data: existing } = await admin
      .from('reports')
      .select('id')
      .eq('organization_id', org.id)
      .eq('kind', 'weekly')
      .eq('period_start', week.start)
      .maybeSingle();
    if (existing) continue;
    const result = await generateWeeklyReport({
      orgId: org.id,
      userId: null,
      madeBy: 'schedule',
      now,
    });
    if (result.status === 'ok') made += 1;
    else if (result.status === 'error') failed += 1;
  }
  return { made, failed };
}
