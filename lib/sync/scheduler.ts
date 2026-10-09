import type { Db } from '@/lib/ingest/ingest';
import { hasConnector } from '@/lib/platforms/registry';
import { runSyncJob, type EngineDeps, type RunOutcome } from './engine';
import { JOB_INTERVAL_MINUTES, type SyncJobType } from './schedule';

const JOB_TYPES = Object.keys(JOB_INTERVAL_MINUTES) as SyncJobType[];

/**
 * Queues the jobs that are due for every active, connected account. Safe to call as
 * often as you like: the database allows one queued or running job per account and
 * job type, so a second call adds nothing.
 */
export async function enqueueDueJobs(db: Db, now: Date = new Date()): Promise<number> {
  const { data: accounts, error } = await db
    .from('social_accounts')
    .select('id, organization_id, platform_key, connection_id, platform_connections!inner(status)')
    .eq('is_active', true)
    .eq('is_competitor', false)
    .not('connection_id', 'is', null)
    .eq('platform_connections.status', 'active');
  if (error) throw new Error(`Could not list accounts: ${error.message}`);
  const eligible = accounts.filter((account) => hasConnector(account.platform_key));
  if (!eligible.length) return 0;

  const { data: states, error: stateError } = await db
    .from('sync_state')
    .select('social_account_id, job_type, last_attempt_at, next_run_after, completed')
    .in(
      'social_account_id',
      eligible.map((account) => account.id),
    );
  if (stateError) throw new Error(`Could not read sync state: ${stateError.message}`);
  const stateFor = new Map(
    states.map((state) => [`${state.social_account_id}:${state.job_type}`, state]),
  );

  const rows = [];
  for (const account of eligible) {
    for (const jobType of JOB_TYPES) {
      const state = stateFor.get(`${account.id}:${jobType}`);
      if (jobType === 'backfill' && state?.completed) continue;
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
    .select('id')
    .eq('status', 'queued')
    .order('queued_at', { ascending: true })
    .limit(options.limit ?? 50);
  if (error) throw new Error(`Could not read the sync queue: ${error.message}`);
  const results = [];
  for (const { id } of queued) {
    results.push({ runId: id, outcome: await runSyncJob(deps, id) });
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
