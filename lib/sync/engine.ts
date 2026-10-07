import type { Json, Tables } from '@/lib/db/types';
import { ingest, type Db, type IngestResult } from '@/lib/ingest/ingest';
import { AuthError, PlatformError, RateLimitError } from '@/lib/platforms/errors';
import type { AccountContext, NormalizedPost, PlatformAdapter } from '@/lib/platforms/types';
import {
  ACCOUNT_RESYNC_DAYS,
  FAILURES_BEFORE_ERROR_STATUS,
  FIRST_ACCOUNT_SYNC_DAYS,
  INCREMENTAL_OVERLAP_DAYS,
  LAST_CAPTURE_HOURS,
  MAX_PAGES,
  MAX_POSTS_PER_REFRESH,
  METRICS_BATCH_SIZE,
  backoffMinutes,
  isSnapshotDue,
  isoDay,
  shiftDay,
} from './schedule';

type SyncRun = Tables<'sync_runs'>;
type Account = Tables<'social_accounts'>;
type SyncState = Tables<'sync_state'>;

export type EngineDeps = {
  db: Db;
  adapterFor: (platformKey: string) => PlatformAdapter | null;
  contextFor: (account: Account) => Promise<AccountContext>;
  now?: () => Date;
};

export type RunOutcome = {
  status: 'succeeded' | 'partial' | 'failed' | 'skipped';
  processed: number;
  failed: number;
  errorCode?: string;
};

const MAX_EVENTS_PER_RUN = 100;

class RunLog {
  processed = 0;
  failed = 0;
  lastErrorMessage: string | null = null;
  private events: { level: string; code: string; message: string; context?: Json }[] = [];

  constructor(
    private readonly db: Db,
    private readonly run: SyncRun,
  ) {}

  event(level: 'info' | 'warning' | 'error', code: string, message: string, context?: Json) {
    if (this.events.length < MAX_EVENTS_PER_RUN)
      this.events.push({ level, code, message, context });
  }

  count(result: IngestResult) {
    this.processed +=
      result.postsWritten + result.postMetricsWritten + result.accountMetricsWritten;
    if (result.rejected.length) {
      this.failed += result.rejected.length;
      this.event(
        'warning',
        'rejected_records',
        `${result.rejected.length} records failed validation`,
        {
          sample: result.rejected.slice(0, 10),
        },
      );
    }
  }

  async flush() {
    if (!this.events.length) return;
    const rows = this.events.map((event) => ({
      ...event,
      sync_run_id: this.run.id,
      organization_id: this.run.organization_id,
    }));
    this.events = [];
    await this.db.from('sync_run_events').insert(rows);
  }
}

/**
 * Runs one queued sync job end to end: claim it, read from the platform through the
 * adapter, write through ingest, record progress and outcome. Progress (cursors,
 * written rows) is saved as it goes, so a failure loses work in progress, never data.
 */
export async function runSyncJob(deps: EngineDeps, runId: string): Promise<RunOutcome> {
  const now = deps.now ?? (() => new Date());
  const { db } = deps;

  // Claim: only one worker can move a run from queued to running.
  const { data: claimed, error: claimError } = await db
    .from('sync_runs')
    .update({ status: 'running', started_at: now().toISOString() })
    .eq('id', runId)
    .eq('status', 'queued')
    .select()
    .maybeSingle();
  if (claimError) throw new Error(`Could not claim sync run: ${claimError.message}`);
  if (!claimed) return { status: 'skipped', processed: 0, failed: 0 };
  const run = claimed;

  const log = new RunLog(db, run);
  const { data: account, error: accountError } = await db
    .from('social_accounts')
    .select('*')
    .eq('id', run.social_account_id)
    .single();
  if (accountError) throw new Error(`Could not load account: ${accountError.message}`);

  const { data: existingState } = await db
    .from('sync_state')
    .select('*')
    .eq('social_account_id', account.id)
    .eq('job_type', run.job_type)
    .maybeSingle();
  const state: SyncState = existingState ?? {
    social_account_id: account.id,
    organization_id: account.organization_id,
    job_type: run.job_type,
    cursor: null,
    last_success_at: null,
    last_attempt_at: null,
    next_run_after: null,
    consecutive_failures: 0,
    completed: false,
  };
  state.last_attempt_at = now().toISOString();

  let outcome: RunOutcome;
  try {
    const adapter = deps.adapterFor(account.platform_key);
    if (!adapter)
      throw new PlatformError(`No connector for ${account.platform_key}`, 'no_connector');
    if (!account.connection_id || !account.is_active) {
      throw new PlatformError('The account is not active and connected', 'not_connected');
    }
    const ctx = await deps.contextFor(account);
    const job = new JobContext(deps, run, account, state, adapter, ctx, log, now);
    await job.execute();

    state.last_success_at = now().toISOString();
    state.consecutive_failures = 0;
    state.next_run_after = null;
    outcome = {
      status: log.failed > 0 ? 'partial' : 'succeeded',
      processed: log.processed,
      failed: log.failed,
    };
    await db
      .from('social_accounts')
      .update({
        last_successful_sync_at: now().toISOString(),
        ...(account.connection_status === 'error'
          ? { connection_status: 'connected' as const }
          : {}),
      })
      .eq('id', account.id);
  } catch (error) {
    outcome = await handleFailure(deps, run, account, state, log, error, now);
  }

  await db.from('sync_state').upsert(state, { onConflict: 'social_account_id,job_type' });
  await log.flush();
  await db
    .from('sync_runs')
    .update({
      status: outcome.status === 'skipped' ? 'cancelled' : outcome.status,
      completed_at: now().toISOString(),
      records_processed: outcome.processed,
      records_failed: outcome.failed,
      error_code: outcome.errorCode ?? null,
      error_message: outcome.errorCode ? log.lastErrorMessage : null,
    })
    .eq('id', run.id);
  return outcome;
}

async function handleFailure(
  deps: EngineDeps,
  run: SyncRun,
  account: Account,
  state: SyncState,
  log: RunLog,
  error: unknown,
  now: () => Date,
): Promise<RunOutcome> {
  const { db } = deps;
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof PlatformError ? error.code : 'internal_error';
  log.lastErrorMessage = message;
  log.event('error', code, message);

  if (error instanceof AuthError) {
    // Stop everything for this connection until someone reconnects.
    if (account.connection_id) {
      await db
        .from('platform_connections')
        .update({ status: 'needs_reauth', last_error: message })
        .eq('id', account.connection_id);
      await db
        .from('social_accounts')
        .update({ connection_status: 'needs_reauth' })
        .eq('connection_id', account.connection_id);
    }
    state.consecutive_failures += 1;
    return { status: 'failed', processed: log.processed, failed: log.failed, errorCode: code };
  }

  if (error instanceof RateLimitError) {
    state.next_run_after = new Date(now().getTime() + error.retryAfterSeconds * 1000).toISOString();
    // Being asked to slow down is not a failure of the account; work done so far is kept.
    return {
      status: log.processed > 0 ? 'partial' : 'failed',
      processed: log.processed,
      failed: log.failed,
      errorCode: code,
    };
  }

  state.consecutive_failures += 1;
  state.next_run_after = new Date(
    now().getTime() + backoffMinutes(state.consecutive_failures) * 60_000,
  ).toISOString();
  if (
    state.consecutive_failures >= FAILURES_BEFORE_ERROR_STATUS &&
    account.connection_status === 'connected'
  ) {
    await db.from('social_accounts').update({ connection_status: 'error' }).eq('id', account.id);
  }
  return {
    status: log.processed > 0 ? 'partial' : 'failed',
    processed: log.processed,
    failed: log.failed,
    errorCode: code,
  };
}

class JobContext {
  constructor(
    private readonly deps: EngineDeps,
    private readonly run: SyncRun,
    private readonly account: Account,
    private readonly state: SyncState,
    private readonly adapter: PlatformAdapter,
    private readonly ctx: AccountContext,
    private readonly log: RunLog,
    private readonly now: () => Date,
  ) {}

  private get db() {
    return this.deps.db;
  }

  async execute() {
    switch (this.run.job_type) {
      case 'account_daily':
        return this.accountDaily();
      case 'posts_incremental':
        return this.postsIncremental();
      case 'post_metrics_refresh':
        return this.postMetricsRefresh();
      case 'backfill':
        return this.backfill();
    }
  }

  private async write(
    input: Omit<
      Parameters<typeof ingest>[1],
      'organizationId' | 'socialAccountId' | 'platformKey' | 'dataSource' | 'syncRunId'
    >,
  ) {
    const result = await ingest(
      this.db,
      {
        ...input,
        organizationId: this.account.organization_id,
        socialAccountId: this.account.id,
        platformKey: this.account.platform_key,
        dataSource: 'authenticated',
        syncRunId: this.run.id,
      },
      'sync',
    );
    this.log.count(result);
    await this.storeRawPayloads();
    return result;
  }

  private async storeRawPayloads() {
    const raw = this.adapter.drainRawPayloads?.() ?? [];
    if (!raw.length) return;
    await this.db.from('raw_payloads').insert(
      raw.map((entry) => ({
        organization_id: this.account.organization_id,
        sync_run_id: this.run.id,
        endpoint: entry.endpoint,
        payload: (entry.payload ?? {}) as NonNullable<Json>,
      })),
    );
  }

  private async accountDaily() {
    const today = isoDay(this.now());
    const until = shiftDay(today, -1); // only complete days
    const since = this.state.last_success_at
      ? shiftDay(until, -(ACCOUNT_RESYNC_DAYS - 1))
      : shiftDay(until, -(FIRST_ACCOUNT_SYNC_DAYS - 1));
    const metrics = await this.adapter.getAccountMetrics(this.ctx, { since, until, asOf: today });
    await this.write({ capturedAt: this.now().toISOString(), accountMetrics: metrics });
  }

  /**
   * Fetches metrics right away for posts Scopie has never measured: new posts get an early
   * snapshot, and older posts found by the backfill get one lifetime snapshot (their age is
   * recorded, so analytics never mistake it for an early value).
   */
  private async measureNewPosts(posts: NormalizedPost[], postIds: Map<string, string>) {
    const ids = posts.map((post) => postIds.get(post.externalId)).filter(Boolean) as string[];
    if (!ids.length) return;
    const { data, error } = await this.db
      .from('posts')
      .select('external_id, published_at, last_metrics_at')
      .in('id', ids);
    if (error) throw new Error(`Could not read posts: ${error.message}`);
    const unmeasured = new Set(
      data.filter((row) => row.last_metrics_at === null).map((row) => row.external_id),
    );
    await this.measure(posts.filter((post) => unmeasured.has(post.externalId)));
  }

  private async measure(
    posts: Pick<NormalizedPost, 'externalId' | 'mediaFormat' | 'nativeType'>[],
  ) {
    for (let index = 0; index < posts.length; index += METRICS_BATCH_SIZE) {
      const batch = posts.slice(index, index + METRICS_BATCH_SIZE);
      const result = await this.adapter.getPostMetrics(this.ctx, batch);
      for (const failure of result.failures) {
        this.log.failed += 1;
        this.log.event('warning', 'post_metrics_failed', failure.message, {
          post: failure.postExternalId,
        });
      }
      await this.write({ capturedAt: this.now().toISOString(), postMetrics: result.metrics });
    }
  }

  private async postsIncremental() {
    const { data: newest } = await this.db
      .from('posts')
      .select('published_at')
      .eq('social_account_id', this.account.id)
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const stopBefore = newest
      ? Date.parse(newest.published_at) - INCREMENTAL_OVERLAP_DAYS * 86_400_000
      : null;
    // First sync: read two pages; older posts come in through the backfill job.
    const maxPages = stopBefore === null ? 2 : MAX_PAGES.posts_incremental;

    let cursor: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const result = await this.adapter.listPosts(this.ctx, cursor);
      const written = await this.write({
        capturedAt: this.now().toISOString(),
        posts: result.posts,
      });
      await this.measureNewPosts(result.posts, written.postIds);
      const reachedKnown =
        stopBefore !== null &&
        result.posts.some((post) => Date.parse(post.publishedAt) < stopBefore);
      cursor = result.nextCursor;
      if (!cursor || reachedKnown) break;
    }
  }

  private async postMetricsRefresh() {
    const nowMs = this.now().getTime();
    const since = new Date(nowMs - (LAST_CAPTURE_HOURS + 24) * 3600_000).toISOString();
    const { data, error } = await this.db
      .from('posts')
      .select('external_id, published_at, last_metrics_at, media_format, native_type')
      .eq('social_account_id', this.account.id)
      .is('removed_at', null)
      .gte('published_at', since)
      .order('published_at', { ascending: true });
    if (error) throw new Error(`Could not read posts: ${error.message}`);

    const due = data
      .filter((post) => {
        const published = Date.parse(post.published_at);
        const ageHours = (nowMs - published) / 3600_000;
        const lastAge = post.last_metrics_at
          ? (Date.parse(post.last_metrics_at) - published) / 3600_000
          : null;
        return isSnapshotDue(ageHours, lastAge);
      })
      .slice(0, MAX_POSTS_PER_REFRESH)
      .map((post) => ({
        externalId: post.external_id,
        mediaFormat: post.media_format,
        nativeType: post.native_type,
      }));
    if (due.length === MAX_POSTS_PER_REFRESH) {
      this.log.event('info', 'refresh_capped', `More posts are due; the next run continues.`);
    }
    await this.measure(due);
  }

  private async backfill() {
    if (this.state.completed) return;
    let cursor =
      this.state.cursor && typeof this.state.cursor === 'object' && 'after' in this.state.cursor
        ? (this.state.cursor.after as string | null)
        : null;
    for (let page = 0; page < MAX_PAGES.backfill; page++) {
      const result = await this.adapter.listPosts(this.ctx, cursor);
      const written = await this.write({
        capturedAt: this.now().toISOString(),
        posts: result.posts,
      });
      await this.measureNewPosts(result.posts, written.postIds);
      cursor = result.nextCursor;
      // Save progress after every page, so a failure resumes here.
      this.state.cursor = { after: cursor };
      await this.db
        .from('sync_state')
        .upsert(this.state, { onConflict: 'social_account_id,job_type' });
      if (!cursor) {
        this.state.completed = true;
        await this.recordHistoryStart();
        break;
      }
    }
  }

  private async recordHistoryStart() {
    const { data } = await this.db
      .from('posts')
      .select('published_local_date')
      .eq('social_account_id', this.account.id)
      .order('published_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) {
      await this.db
        .from('social_accounts')
        .update({ history_available_from: data.published_local_date })
        .eq('id', this.account.id);
    }
  }
}
