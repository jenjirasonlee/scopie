import type { Db } from '@/lib/ingest/ingest';
import {
  KEYLESS_PUBLIC_PLATFORMS,
  hasConnector,
  hasPublicCollector,
  isBilledPublic,
  needsViewer,
} from '@/lib/platforms/registry';
import { runSyncJob, type EngineDeps, type RunOutcome } from './engine';
import {
  BILLED_PUBLIC_JOBS,
  CONNECTED_JOBS,
  JOB_INTERVAL_MINUTES,
  PUBLIC_JOBS,
  isPublicJob,
  type SyncJobType,
} from './schedule';

type DueAccount = { id: string; organization_id: string; platform_key: string };

/**
 * Queues the jobs that are due. Two passes: connected jobs for accounts linked to an active
 * owner connection, and public jobs for every active profile on a platform with public data,
 * in organizations that set up a viewer account. A connected Instagram account gets both,
 * so it can be compared with competitors on the same public numbers. Safe to call as often
 * as you like: the database allows one queued or running job per account and job type.
 */
export async function enqueueDueJobs(
  db: Db,
  now: Date = new Date(),
  options: { apiKeyPlatforms?: readonly string[] } = {},
): Promise<number> {
  const { data: connected, error } = await db
    .from('social_accounts')
    .select('id, organization_id, platform_key, platform_connections!inner(status)')
    .eq('is_active', true)
    .not('connection_id', 'is', null)
    .eq('platform_connections.status', 'active');
  if (error) throw new Error(`Could not list accounts: ${error.message}`);

  const { data: viewers, error: viewerError } = await db
    .from('public_data_viewers')
    .select('organization_id, platform_key');
  if (viewerError) throw new Error(`Could not list viewer accounts: ${viewerError.message}`);
  // Viewer platforms (Instagram) need an org's viewer; key platforms (YouTube, X) a server
  // key; keyless platforms (Bluesky) nothing.
  const keyPlatforms = [
    ...new Set([...(options.apiKeyPlatforms ?? []), ...KEYLESS_PUBLIC_PLATFORMS]),
  ].filter((key) => !needsViewer(key));
  let publicProfiles: DueAccount[] = [];
  if (viewers.length || keyPlatforms.length) {
    const { data, error: publicError } = await db
      .from('social_accounts')
      .select('id, organization_id, platform_key, platforms!inner(public_data_status)')
      .eq('is_active', true)
      .not('handle', 'is', null)
      .neq('access_type', 'demo')
      .eq('platforms.public_data_status', 'available');
    if (publicError) throw new Error(`Could not list public profiles: ${publicError.message}`);
    const hasViewer = new Set(viewers.map((v) => `${v.organization_id}:${v.platform_key}`));
    publicProfiles = data.filter(
      (account) =>
        hasPublicCollector(account.platform_key) &&
        (needsViewer(account.platform_key)
          ? hasViewer.has(`${account.organization_id}:${account.platform_key}`)
          : keyPlatforms.includes(account.platform_key)),
    );
  }

  const candidates: { account: DueAccount; jobs: readonly SyncJobType[] }[] = [
    ...connected
      .filter((account) => hasConnector(account.platform_key))
      .map((account) => ({ account, jobs: CONNECTED_JOBS })),
    // Platforms billed per read (X) get only the daily observation, to keep the cost down.
    ...publicProfiles.map((account) => ({
      account,
      jobs: isBilledPublic(account.platform_key) ? BILLED_PUBLIC_JOBS : PUBLIC_JOBS,
    })),
  ];
  if (!candidates.length) return 0;

  const ids = [...new Set(candidates.map(({ account }) => account.id))];
  const { data: states, error: stateError } = await db
    .from('sync_state')
    .select('social_account_id, job_type, last_attempt_at, next_run_after, completed')
    .in('social_account_id', ids);
  if (stateError) throw new Error(`Could not read sync state: ${stateError.message}`);
  const stateFor = new Map(
    states.map((state) => [`${state.social_account_id}:${state.job_type}`, state]),
  );

  const rows = [];
  for (const { account, jobs } of candidates) {
    for (const jobType of jobs) {
      const state = stateFor.get(`${account.id}:${jobType}`);
      if ((jobType === 'backfill' || jobType === 'public_backfill') && state?.completed) continue;
      if (state?.next_run_after && Date.parse(state.next_run_after) > now.getTime()) continue;
      const intervalMs = JOB_INTERVAL_MINUTES[jobType] * 60_000;
      if (state?.last_attempt_at && now.getTime() - Date.parse(state.last_attempt_at) < intervalMs)
        continue;
      rows.push({
        organization_id: account.organization_id,
        social_account_id: account.id,
        platform_key: account.platform_key,
        job_type: jobType,
        trigger: 'schedule' as const,
      });
    }
  }

  let queued = 0;
  for (const row of rows) {
    // Inserted one by one: a conflict (job already queued) must not drop the others.
    const { error: insertError } = await db.from('sync_runs').insert(row);
    if (!insertError) queued += 1;
    else if (insertError.code !== '23505')
      throw new Error(`Could not queue sync: ${insertError.message}`);
  }
  return queued;
}

/** Runs queued jobs oldest first, one at a time, so a token never runs two jobs at once. */
export async function processQueue(
  deps: EngineDeps,
  options: { limit?: number } = {},
): Promise<{ runId: string; outcome: RunOutcome }[]> {
  const { data: queued, error } = await deps.db
    .from('sync_runs')
    .select('id, job_type')
    .eq('status', 'queued')
    .order('queued_at', { ascending: true })
    .limit(options.limit ?? 50);
  if (error) throw new Error(`Could not read the sync queue: ${error.message}`);
  const results = [];
  let publicPaused = false;
  for (const { id, job_type } of queued) {
    // Once Meta reports the app near its hourly limit, public jobs wait for a later tick.
    if (publicPaused && isPublicJob(job_type)) continue;
    const outcome = await runSyncJob(deps, id);
    if (outcome.errorCode === 'usage_paused' || outcome.pausePublic) publicPaused = true;
    results.push({ runId: id, outcome });
  }
  return results;
}

/** Deletes raw platform responses older than 30 days. */
export async function pruneRawPayloads(db: Db, now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const { error } = await db.from('raw_payloads').delete().lt('captured_at', cutoff);
  if (error) throw new Error(`Could not prune raw payloads: ${error.message}`);
}

/**
 * Runs that were left "running" by a crashed worker are marked failed after an hour,
 * which frees the slot for the next scheduled run.
 */
export async function failStaleRuns(db: Db, now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - 3600_000).toISOString();
  const { error } = await db
    .from('sync_runs')
    .update({
      status: 'failed',
      completed_at: now.toISOString(),
      error_code: 'stale',
      error_message: 'The worker stopped before finishing',
    })
    .eq('status', 'running')
    .lt('started_at', cutoff);
  if (error) throw new Error(`Could not clean up stale runs: ${error.message}`);
}

/**
 * Makes a platform's never-read public profiles due now. Called when an organization chooses
 * its viewer account, so profiles added before that are read on the next tick instead of
 * waiting out a failed attempt's interval.
 */
export async function releaseSetupBlockedJobs(
  db: Db,
  organizationId: string,
  platformKey: string,
): Promise<void> {
  const { data: accounts, error } = await db
    .from('social_accounts')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('platform_key', platformKey);
  if (error) throw new Error(`Could not list profiles: ${error.message}`);
  if (!accounts.length) return;
  const { error: updateError } = await db
    .from('sync_state')
    .update({ last_attempt_at: null, next_run_after: null })
    .in(
      'social_account_id',
      accounts.map((account) => account.id),
    )
    .in('job_type', [...PUBLIC_JOBS])
    .is('last_success_at', null);
  if (updateError) throw new Error(`Could not reset sync state: ${updateError.message}`);
}
