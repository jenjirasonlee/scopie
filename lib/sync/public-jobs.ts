import type { Json, Tables } from '@/lib/db/types';
import { ingest, type IngestResult } from '@/lib/ingest/ingest';
import { AuthError, PlatformError, RateLimitError } from '@/lib/platforms/errors';
import type {
  PublicContext,
  PublicPostPage,
  PublicProfile,
  PublicProfileCollector,
} from '@/lib/platforms/types';
import type { EngineDeps } from './engine';
import {
  MAX_PAGES,
  PUBLIC_BACKFILL_MONTHS,
  PUBLIC_USAGE_PAUSE_PERCENT,
  isSnapshotDue,
  isoDay,
} from './schedule';

type SyncRun = Tables<'sync_runs'>;
type Account = Tables<'social_accounts'>;
type SyncState = Tables<'sync_state'>;

/** Public posts are re-measured until this age; older posts keep their last observation. */
export const PUBLIC_REFRESH_DAYS = 31;

export type PublicJobLog = {
  count(result: IngestResult): void;
  event(level: 'info' | 'warning' | 'error', code: string, message: string, context?: Json): void;
};

/** Raised when Meta reports the app is close to its hourly limit; the queue stops for now. */
export class UsagePausedError extends RateLimitError {
  constructor(percent: number) {
    super(
      60 * 60,
      `Paused: Meta reports ${Math.round(percent)}% of the hourly limit used. Public reads resume within the hour.`,
    );
  }
  override readonly code = 'usage_paused';
}

/**
 * Runs one public job: reads a profile through the organization's viewer account and
 * stores what was observed, labelled live_public. Nothing is written for data that was
 * not observed; a failed run leaves a gap, never a zero or a copied value.
 */
export async function runPublicJob(
  deps: EngineDeps,
  run: SyncRun,
  account: Account,
  state: SyncState,
  log: PublicJobLog,
  now: () => Date,
): Promise<{ nearLimit: boolean }> {
  const collector = deps.collectorFor?.(account.platform_key) ?? null;
  if (!collector || !deps.publicContextFor) {
    throw new PlatformError(
      `Public data isn't available for ${account.platform_key} yet`,
      'no_connector',
    );
  }
  if (!account.is_active) throw new PlatformError('The profile is paused', 'inactive');
  if (!account.handle) {
    throw new PlatformError('The profile has no username to look up', 'no_handle');
  }
  const ctx = await deps.publicContextFor(account.organization_id, account.platform_key);
  const job = new PublicJob(deps, run, account, state, collector, ctx, log, now);
  try {
    await job.execute();
    return { nearLimit: job.nearLimit };
  } catch (error) {
    if (error instanceof AuthError && ctx.connectionId) {
      // The viewer's token failed, not the profile. Ask for the viewer to be reconnected.
      await deps.db
        .from('platform_connections')
        .update({ status: 'needs_reauth', last_error: error.message })
        .eq('id', ctx.connectionId);
      throw new PlatformError(
        'The viewer account needs to be reconnected in Settings → Connections',
        'viewer_auth',
      );
    }
    throw error;
  }
}

class PublicJob {
  nearLimit = false;

  constructor(
    private readonly deps: EngineDeps,
    private readonly run: SyncRun,
    private readonly account: Account,
    private readonly state: SyncState,
    private readonly collector: PublicProfileCollector,
    private readonly ctx: PublicContext,
    private readonly log: PublicJobLog,
    private readonly now: () => Date,
  ) {}

  private get db() {
    return this.deps.db;
  }

  private get handle() {
    return this.account.handle!;
  }

  async execute() {
    switch (this.run.job_type) {
      case 'public_profile_daily':
        return this.profileDaily();
      case 'public_posts_refresh':
        return this.postsRefresh();
      case 'public_backfill':
        return this.backfill();
      default:
        throw new PlatformError(`${this.run.job_type} is not a public job`, 'invalid_job');
    }
  }

  /** Stops the run when Meta says the app is near its hourly limit. Work so far is kept. */
  private checkUsage() {
    const usage = this.collector.appUsage ?? 0;
    if (usage >= PUBLIC_USAGE_PAUSE_PERCENT) throw new UsagePausedError(usage);
  }

  private async write(
    input: Pick<Parameters<typeof ingest>[1], 'posts' | 'postMetrics' | 'accountMetrics'>,
    capturedAt: string,
  ) {
    const result = await ingest(
      this.db,
      {
        ...input,
        organizationId: this.account.organization_id,
        socialAccountId: this.account.id,
        platformKey: this.account.platform_key,
        dataSource: 'live_public',
        syncRunId: this.run.id,
        capturedAt,
      },
      'sync',
    );
    this.log.count(result);
    const raw = this.collector.drainRawPayloads?.() ?? [];
    if (raw.length) {
      await this.db.from('raw_payloads').insert(
        raw.map((entry) => ({
          organization_id: this.account.organization_id,
          sync_run_id: this.run.id,
          endpoint: entry.endpoint,
          payload: (entry.payload ?? {}) as NonNullable<Json>,
        })),
      );
    }
    return result;
  }

  /**
   * Last public observation of each post, from live_public snapshots only: a connected
   * profile's insights snapshots are a different source and don't count here.
   */
  private async lastPublicCapture(externalIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!externalIds.length) return out;
    const { data: posts, error } = await this.db
      .from('posts')
      .select('id, external_id')
      .eq('social_account_id', this.account.id)
      .in('external_id', externalIds);
    if (error) throw new Error(`Could not read posts: ${error.message}`);
    if (!posts.length) return out;
    const externalFor = new Map(posts.map((post) => [post.id, post.external_id]));
    const { data: snapshots, error: snapshotError } = await this.db
      .from('post_metric_snapshots')
      .select('post_id, captured_at')
      .in('post_id', [...externalFor.keys()])
      .eq('data_source', 'live_public')
      .eq('metric_key', 'comments');
    if (snapshotError) throw new Error(`Could not read snapshots: ${snapshotError.message}`);
    for (const row of snapshots) {
      const externalId = externalFor.get(row.post_id)!;
      const previous = out.get(externalId);
      if (!previous || row.captured_at > previous) out.set(externalId, row.captured_at);
    }
    return out;
  }

  /**
   * Stores a page: every post, and metrics only for posts never observed publicly or that
   * have reached a capture age since their last observation. Returns the posts' times.
   */
  private async storePage(page: PublicPostPage, capturedAt: string, onlyNew = false) {
    const nowMs = Date.parse(capturedAt);
    const last = await this.lastPublicCapture(page.posts.map((post) => post.externalId));
    const due = new Set(
      page.posts
        .filter((post) => {
          const lastAt = last.get(post.externalId);
          if (!lastAt) return true;
          if (onlyNew) return false;
          const published = Date.parse(post.publishedAt);
          return isSnapshotDue(
            (nowMs - published) / 3600_000,
            (Date.parse(lastAt) - published) / 3600_000,
          );
        })
        .map((post) => post.externalId),
    );
    await this.write(
      {
        posts: page.posts,
        postMetrics: page.metrics.filter((metric) => due.has(metric.postExternalId)),
      },
      capturedAt,
    );
    return page.posts.map((post) => Date.parse(post.publishedAt));
  }

  private async profileDaily() {
    const capturedAt = this.now().toISOString();
    const observation = await this.collector.observeProfile(
      this.ctx,
      this.handle,
      isoDay(this.now()),
    );
    await this.checkIdentity(observation.profile);
    await this.write({ accountMetrics: observation.accountMetrics }, capturedAt);
    await this.storePage(observation.firstPage, capturedAt);
    await this.recordProfile(observation.profile, capturedAt);
    await this.markObserved(capturedAt);
    // The observation is complete, so the run succeeds; only the jobs after it wait.
    this.nearLimit = (this.collector.appUsage ?? 0) >= PUBLIC_USAGE_PAUSE_PERCENT;
  }

  private async markObserved(capturedAt: string) {
    await this.db
      .from('social_accounts')
      .update({
        last_observed_at: capturedAt,
        ...(this.account.first_observed_at ? {} : { first_observed_at: capturedAt }),
      })
      .eq('id', this.account.id);
  }

  /**
   * The username must still belong to the account first observed. If someone else now
   * owns it, stop rather than mix two accounts' history.
   */
  private async checkIdentity(profile: PublicProfile) {
    if (!this.account.external_id) {
      const { error } = await this.db
        .from('social_accounts')
        .update({ external_id: profile.externalId })
        .eq('id', this.account.id);
      if (error) throw new Error(`Could not save the account id: ${error.message}`);
      this.account.external_id = profile.externalId;
    } else if (this.account.external_id !== profile.externalId) {
      throw new PlatformError(
        `@${this.handle} now belongs to a different Instagram account. Check the username; no data was stored.`,
        'profile_changed',
      );
    }
  }

  /** Saves the profile's public fields when any of them changed since the last snapshot. */
  private async recordProfile(profile: PublicProfile, observedAt: string) {
    const { data: latest } = await this.db
      .from('profile_snapshots')
      .select('username, display_name, biography, website, profile_picture_url')
      .eq('social_account_id', this.account.id)
      .order('observed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const next = {
      username: profile.username,
      display_name: profile.displayName,
      biography: profile.biography,
      website: profile.website,
      // Picture URLs are signed and change daily; only a change from none to some counts.
      profile_picture_url: profile.profilePictureUrl,
    };
    const changed =
      !latest ||
      latest.username !== next.username ||
      latest.display_name !== next.display_name ||
      latest.biography !== next.biography ||
      latest.website !== next.website ||
      (latest.profile_picture_url === null) !== (next.profile_picture_url === null);
    if (!changed) return;
    const { error } = await this.db.from('profile_snapshots').insert({
      ...next,
      organization_id: this.account.organization_id,
      social_account_id: this.account.id,
      observed_at: observedAt,
      data_source: 'live_public',
      sync_run_id: this.run.id,
    });
    if (error) throw new Error(`Could not store the profile snapshot: ${error.message}`);
  }

  /** Re-reads recent posts and stores a snapshot for each one that reached a capture age. */
  private async postsRefresh() {
    const capturedAt = this.now().toISOString();
    const oldest = this.now().getTime() - PUBLIC_REFRESH_DAYS * 86_400_000;
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES.public_posts_refresh; page++) {
      const result = await this.collector.listPosts(this.ctx, this.handle, cursor);
      const times = await this.storePage(result, capturedAt);
      this.checkUsage();
      cursor = result.nextCursor;
      if (!cursor || times.some((time) => time < oldest)) break;
    }
  }

  /**
   * Reads older posts once, up to 12 months back or MAX_PAGES pages in total, storing each
   * post with its current public totals. Records how far back post history is complete.
   */
  private async backfill() {
    if (this.state.completed) return;
    const saved =
      this.state.cursor &&
      typeof this.state.cursor === 'object' &&
      !Array.isArray(this.state.cursor)
        ? (this.state.cursor as { after?: string | null; pages?: number })
        : {};
    let cursor = saved.after ?? null;
    let pages = saved.pages ?? 0;
    const limitMs = this.now().getTime() - PUBLIC_BACKFILL_MONTHS * 30.44 * 86_400_000;
    let reachedEnd = false;
    while (pages < MAX_PAGES.public_backfill) {
      const capturedAt = this.now().toISOString();
      const result = await this.collector.listPosts(this.ctx, this.handle, cursor);
      const within: PublicPostPage = {
        ...result,
        posts: result.posts.filter((post) => Date.parse(post.publishedAt) >= limitMs),
      };
      await this.storePage(within, capturedAt, true);
      pages += 1;
      cursor = result.nextCursor;
      // Save progress after every page, so a failure resumes here.
      this.state.cursor = { after: cursor, pages };
      await this.db
        .from('sync_state')
        .upsert(this.state, { onConflict: 'social_account_id,job_type' });
      if (!cursor) reachedEnd = true;
      if (!cursor || within.posts.length < result.posts.length) break;
      this.checkUsage();
    }
    // Reaching the first post, the 12-month limit or the page limit all end the backfill.
    this.state.completed = true;
    await this.recordEarliestPost(reachedEnd);
  }

  /**
   * earliest_post_at: from this time on, Scopie holds every post the profile published, so
   * posting frequency is only computed after it.
   */
  private async recordEarliestPost(reachedFirstPost: boolean) {
    const { data } = await this.db
      .from('posts')
      .select('published_at')
      .eq('social_account_id', this.account.id)
      .order('published_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!data) return;
    this.log.event(
      'info',
      'backfill_complete',
      reachedFirstPost
        ? 'Read back to the profile’s first post.'
        : 'Read back as far as the backfill limit allows.',
    );
    await this.db
      .from('social_accounts')
      .update({ earliest_post_at: data.published_at })
      .eq('id', this.account.id);
  }
}
