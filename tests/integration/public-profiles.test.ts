import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptToken } from '@/lib/crypto/tokens';
import { AuthError } from '@/lib/platforms/errors';
import type {
  NormalizedPostMetric,
  PublicPostPage,
  PublicProfile,
  PublicProfileCollector,
} from '@/lib/platforms/types';
import { loadAccountContext, loadPublicContext } from '@/lib/sync/credentials';
import { runSyncJob, type EngineDeps } from '@/lib/sync/engine';
import { enqueueDueJobs, processQueue, releaseSetupBlockedJobs } from '@/lib/sync/scheduler';
import {
  addMember,
  adminClient,
  cleanup,
  createOrg,
  createUser,
  type TestUser,
} from '../support/supabase';

const ENCRYPTION_KEY = randomBytes(32).toString('base64');
const admin = adminClient();

let owner: TestUser;
let viewer: TestUser;
let orgId: string;
let connectionId: string;
let viewerAssetId: string;
let competitorId: string;

/** A stand-in for Business Discovery whose answers the test controls. */
class FakeCollector implements PublicProfileCollector {
  readonly platformKey = 'instagram';
  appUsage = 0;
  profile: PublicProfile = {
    externalId: 'ig-competitor-1',
    username: 'rival_brand',
    displayName: 'Rival Brand (fixture)',
    biography: 'Fixture bio',
    website: null,
    profilePictureUrl: null,
  };
  followers = 20400;
  fail: Error | null = null;
  calls: string[] = [];

  page(): PublicPostPage {
    const posts = [
      {
        externalId: 'rival-post-1',
        publishedAt: '2026-10-05T09:00:00.000Z',
        permalink: 'https://www.instagram.com/p/RIVAL1/',
        caption: 'Launch day #hydro #nutrients',
        mediaFormat: 'image' as const,
        nativeType: 'IMAGE/FEED',
      },
    ];
    const metric = (key: string, value: number | null, availability: string) =>
      ({
        postExternalId: 'rival-post-1',
        metricKey: key,
        sourceMetric: `business_discovery.${key}`,
        value,
        availability,
        period: 'lifetime',
        metricDate: null,
      }) as NormalizedPostMetric;
    return {
      posts,
      metrics: [
        metric('likes', null, 'hidden_by_owner'),
        metric('comments', 12, 'available'),
        metric('views', null, 'not_applicable'),
      ],
      nextCursor: null,
    };
  }

  async lookupProfile() {
    return { profile: this.profile, accountMetrics: [] };
  }

  async observeProfile(_ctx: unknown, handle: string, asOf: string) {
    this.calls.push(`observe:${handle}`);
    if (this.fail) throw this.fail;
    return {
      profile: this.profile,
      accountMetrics: [
        {
          metricKey: 'followers',
          sourceMetric: 'business_discovery.followers_count',
          value: this.followers,
          availability: 'available' as const,
          period: 'lifetime' as const,
          metricDate: asOf,
        },
      ],
      firstPage: this.page(),
    };
  }

  async listPosts(_ctx: unknown, handle: string) {
    this.calls.push(`list:${handle}`);
    if (this.fail) throw this.fail;
    return this.page();
  }
}

function deps(collector: FakeCollector, now: string): EngineDeps {
  return {
    db: admin,
    adapterFor: () => null,
    contextFor: (account) => loadAccountContext(admin, account, ENCRYPTION_KEY),
    collectorFor: () => collector,
    publicContextFor: (org, platform) => loadPublicContext(admin, org, platform, ENCRYPTION_KEY),
    now: () => new Date(now),
  };
}

async function queue(job: 'public_profile_daily' | 'public_posts_refresh' | 'public_backfill') {
  const { data, error } = await owner.client.rpc('request_sync', {
    account_id: competitorId,
    job,
  });
  if (error) throw error;
  return data!;
}

beforeAll(async () => {
  owner = await createUser('public-owner');
  viewer = await createUser('public-viewer');
  orgId = (await createOrg(owner, 'Public Intelligence Org')).id;
  await addMember(orgId, viewer, 'VIEWER');

  // A Meta connection with one Instagram professional account (any account will do).
  const { data: connection, error } = await admin
    .from('platform_connections')
    .insert({
      organization_id: orgId,
      provider: 'meta',
      external_user_id: 'fixture-user',
      status: 'active',
    })
    .select('id')
    .single();
  if (error) throw error;
  connectionId = connection.id;
  await admin.from('connection_credentials').insert({
    connection_id: connectionId,
    organization_id: orgId,
    asset_external_id: 'fixture-page-9',
    ciphertext: encryptToken('fixture-viewer-page-token', ENCRYPTION_KEY),
    key_version: 1,
  });
  const { data: asset } = await admin
    .from('connection_assets')
    .insert({
      organization_id: orgId,
      connection_id: connectionId,
      platform_key: 'instagram',
      external_id: 'ig-viewer-1',
      parent_external_id: 'fixture-page-9',
      name: 'research_viewer',
      account_type: 'business',
    })
    .select('id')
    .single();
  viewerAssetId = asset!.id;

  const { data: competitor, error: competitorError } = await owner.client
    .from('social_accounts')
    .insert({
      organization_id: orgId,
      platform_key: 'instagram',
      display_name: 'Rival Brand',
      handle: 'rival_brand',
      business_role: 'competitor',
      country_code: 'NL',
    })
    .select('id')
    .single();
  if (competitorError) throw competitorError;
  competitorId = competitor.id;
});

afterAll(cleanup);

describe('public profiles', () => {
  it('are public profiles, with no owner connection', async () => {
    const { data } = await owner.client
      .from('social_accounts')
      .select('access_type, business_role, connection_id, first_observed_at')
      .eq('id', competitorId)
      .single();
    expect(data).toEqual({
      access_type: 'public',
      business_role: 'competitor',
      connection_id: null,
      first_observed_at: null,
    });
  });

  it('cannot be connected, because only own profiles have an owner to authorize', async () => {
    const { error } = await owner.client.rpc('link_connection_asset', {
      asset_id: viewerAssetId,
      account_id: competitorId,
    });
    expect(error?.message).toMatch(/Only your own profiles/);
  });

  it('are not synced until a viewer account is chosen', async () => {
    await expect(
      loadPublicContext(admin, orgId, 'instagram', ENCRYPTION_KEY),
    ).rejects.toMatchObject({ code: 'no_viewer' });
    const queued = await enqueueDueJobs(admin, new Date('2026-10-07T06:00:00Z'));
    const { count } = await admin
      .from('sync_runs')
      .select('*', { count: 'exact', head: true })
      .eq('social_account_id', competitorId);
    expect(queued).toBe(0);
    expect(count).toBe(0);
  });

  it('stay due after a read that failed only because no viewer was chosen yet', async () => {
    const runId = await queue('public_profile_daily');
    const outcome = await runSyncJob(deps(new FakeCollector(), '2026-10-07T05:00:00Z'), runId);
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'no_viewer' });
    const { data } = await admin
      .from('sync_state')
      .select('last_attempt_at, next_run_after, consecutive_failures')
      .eq('social_account_id', competitorId)
      .eq('job_type', 'public_profile_daily')
      .single();
    expect(data).toEqual({ last_attempt_at: null, next_run_after: null, consecutive_failures: 0 });
    await admin.from('sync_runs').delete().eq('social_account_id', competitorId);
  });
});

describe('viewer account', () => {
  it('can only be chosen by managers', async () => {
    const { error } = await viewer.client.rpc('set_public_data_viewer', {
      asset_id: viewerAssetId,
    });
    expect(error?.code).toBe('42501');
  });

  it('is chosen from a connected Instagram account', async () => {
    const { error } = await owner.client.rpc('set_public_data_viewer', {
      asset_id: viewerAssetId,
    });
    expect(error).toBeNull();
    const { data } = await viewer.client.from('public_data_viewers').select('platform_key');
    expect(data).toEqual([{ platform_key: 'instagram' }]);
  });

  it('makes profiles that were never read due again once chosen', async () => {
    // A failed attempt from before the viewer existed, saved with a day-long wait.
    await admin.from('sync_state').upsert({
      social_account_id: competitorId,
      organization_id: orgId,
      job_type: 'public_posts_refresh',
      last_attempt_at: '2026-10-07T05:00:00Z',
      next_run_after: '2026-10-08T05:00:00Z',
      consecutive_failures: 1,
    });
    await releaseSetupBlockedJobs(admin, orgId, 'instagram');
    const { data } = await admin
      .from('sync_state')
      .select('last_attempt_at, next_run_after')
      .eq('social_account_id', competitorId)
      .eq('job_type', 'public_posts_refresh')
      .single();
    expect(data).toEqual({ last_attempt_at: null, next_run_after: null });
  });

  it('cannot be written directly', async () => {
    const { error } = await owner.client
      .from('public_data_viewers')
      .update({ connection_asset_id: viewerAssetId })
      .eq('organization_id', orgId);
    const { data } = await owner.client.from('public_data_viewers').select('platform_key');
    expect(error ?? data).toBeTruthy();
  });

  it('gives the worker the viewer id and its Page token', async () => {
    const ctx = await loadPublicContext(admin, orgId, 'instagram', ENCRYPTION_KEY);
    expect(ctx).toEqual({
      viewerId: 'ig-viewer-1',
      connectionId,
      credential: 'fixture-viewer-page-token',
    });
  });
});

describe('public observation', () => {
  const collector = new FakeCollector();

  it('queues the three public jobs once a viewer exists', async () => {
    const queued = await enqueueDueJobs(admin, new Date('2026-10-07T06:00:00Z'));
    const { data } = await admin
      .from('sync_runs')
      .select('job_type')
      .eq('social_account_id', competitorId)
      .eq('status', 'queued');
    expect(queued).toBe(3);
    expect(data!.map((row) => row.job_type).sort()).toEqual([
      'public_backfill',
      'public_posts_refresh',
      'public_profile_daily',
    ]);
    await admin.from('sync_runs').delete().eq('social_account_id', competitorId);
  });

  it('stores what was observed as PUBLIC data, with the observation time', async () => {
    const runId = await queue('public_profile_daily');
    const outcome = await runSyncJob(deps(collector, '2026-10-07T06:00:00Z'), runId);
    expect(outcome.status).toBe('succeeded');

    const { data: followers } = await owner.client
      .from('account_metric_snapshots')
      .select('metric_key, value, data_source, metric_date')
      .eq('social_account_id', competitorId);
    expect(followers).toEqual([
      {
        metric_key: 'followers',
        value: 20400,
        data_source: 'live_public',
        metric_date: '2026-10-07',
      },
    ]);
    const { data: account } = await owner.client
      .from('social_accounts')
      .select('external_id, first_observed_at, last_observed_at, access_type')
      .eq('id', competitorId)
      .single();
    expect(account).toMatchObject({ external_id: 'ig-competitor-1', access_type: 'public' });
    expect(Date.parse(account!.first_observed_at!)).toBe(Date.parse('2026-10-07T06:00:00Z'));
  });

  it('keeps hidden likes as "hidden by owner", never zero', async () => {
    const { data: post } = await owner.client
      .from('posts')
      .select('id, data_source, hashtags')
      .eq('external_id', 'rival-post-1')
      .single();
    expect(post).toMatchObject({ data_source: 'live_public', hashtags: ['hydro', 'nutrients'] });
    const { data: facts } = await owner.client
      .from('post_metric_snapshots')
      .select('metric_key, value, availability, data_source')
      .eq('post_id', post!.id)
      .order('metric_key');
    expect(facts).toEqual([
      { metric_key: 'comments', value: 12, availability: 'available', data_source: 'live_public' },
      {
        metric_key: 'likes',
        value: null,
        availability: 'hidden_by_owner',
        data_source: 'live_public',
      },
      {
        metric_key: 'views',
        value: null,
        availability: 'not_applicable',
        data_source: 'live_public',
      },
    ]);
  });

  it('records a profile snapshot only when the profile changed', async () => {
    collector.followers = 20500;
    await runSyncJob(deps(collector, '2026-10-08T06:00:00Z'), await queue('public_profile_daily'));
    collector.profile = { ...collector.profile, biography: 'New bio' };
    await runSyncJob(deps(collector, '2026-10-09T06:00:00Z'), await queue('public_profile_daily'));
    const { data: snapshots } = await owner.client
      .from('profile_snapshots')
      .select('biography, data_source')
      .eq('social_account_id', competitorId)
      .order('observed_at');
    expect(snapshots).toEqual([
      { biography: 'Fixture bio', data_source: 'live_public' },
      { biography: 'New bio', data_source: 'live_public' },
    ]);
    const { count } = await owner.client
      .from('account_metric_snapshots')
      .select('*', { count: 'exact', head: true })
      .eq('social_account_id', competitorId);
    expect(count).toBe(3); // one follower observation per day
  });

  it('stops if the username now belongs to a different account', async () => {
    collector.profile = { ...collector.profile, externalId: 'someone-else' };
    const outcome = await runSyncJob(
      deps(collector, '2026-10-10T06:00:00Z'),
      await queue('public_profile_daily'),
    );
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'profile_changed' });
    const { count } = await owner.client
      .from('account_metric_snapshots')
      .select('*', { count: 'exact', head: true })
      .eq('social_account_id', competitorId);
    expect(count).toBe(3); // nothing stored for that day: a gap, not a copied value
    collector.profile = { ...collector.profile, externalId: 'ig-competitor-1' };
  });

  it('records how far back post history is complete', async () => {
    const outcome = await runSyncJob(
      deps(collector, '2026-10-10T07:00:00Z'),
      await queue('public_backfill'),
    );
    expect(outcome.status).toBe('succeeded');
    const { data } = await owner.client
      .from('social_accounts')
      .select('earliest_post_at')
      .eq('id', competitorId)
      .single();
    expect(Date.parse(data!.earliest_post_at!)).toBe(Date.parse('2026-10-05T09:00:00Z'));
  });

  it('pauses public reads when Meta reports the app near its hourly limit', async () => {
    collector.appUsage = 85;
    const runId = await queue('public_posts_refresh');
    const outcome = await runSyncJob(deps(collector, '2026-10-12T06:00:00Z'), runId);
    expect(outcome.errorCode).toBe('usage_paused');
    const { data: state } = await admin
      .from('sync_state')
      .select('next_run_after')
      .eq('social_account_id', competitorId)
      .eq('job_type', 'public_posts_refresh')
      .single();
    expect(Date.parse(state!.next_run_after!)).toBe(Date.parse('2026-10-12T07:00:00Z'));
    collector.appUsage = 0;
  });

  it('marks the viewer connection for reconnecting when its token fails', async () => {
    collector.fail = new AuthError('Token expired');
    const outcome = await runSyncJob(
      deps(collector, '2026-10-13T06:00:00Z'),
      await queue('public_profile_daily'),
    );
    expect(outcome.errorCode).toBe('viewer_auth');
    const { data } = await admin
      .from('platform_connections')
      .select('status')
      .eq('id', connectionId)
      .single();
    expect(data!.status).toBe('needs_reauth');
    collector.fail = null;
    await admin.from('platform_connections').update({ status: 'active' }).eq('id', connectionId);
  });

  it('skips the remaining public jobs in a tick once usage is high', async () => {
    collector.appUsage = 90;
    await admin.from('sync_runs').delete().eq('status', 'queued');
    await queue('public_posts_refresh');
    await queue('public_profile_daily');
    const results = await processQueue(deps(collector, '2026-10-14T06:00:00Z'));
    expect(results).toHaveLength(1);
    collector.appUsage = 0;
    await admin.from('sync_runs').delete().eq('status', 'queued');
  });

  it('keeps a complete daily observation when usage is high, then pauses the rest', async () => {
    collector.appUsage = 90;
    await admin.from('sync_runs').delete().eq('status', 'queued');
    await queue('public_profile_daily');
    await queue('public_posts_refresh');
    const results = await processQueue(deps(collector, '2026-10-15T06:00:00Z'));
    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toMatchObject({ status: 'succeeded', pausePublic: true });
    collector.appUsage = 0;
    await admin.from('sync_runs').delete().eq('status', 'queued');
  });

  it('never lets a user write public data themselves', async () => {
    const { error } = await owner.client.from('posts').insert({
      organization_id: orgId,
      social_account_id: competitorId,
      platform_key: 'instagram',
      external_id: 'forged',
      published_at: '2026-10-01T10:00:00Z',
      published_local_date: '2026-10-01',
      data_source: 'live_public',
    });
    expect(error?.message).toMatch(/Only imported data can be added by users/);
  });
});

describe('removing a profile', () => {
  it('can only be done by managers', async () => {
    const { error } = await viewer.client.rpc('remove_profile_and_data', {
      account_id: competitorId,
    });
    expect(error?.code).toBe('42501');
  });

  it('deletes the profile and everything observed about it', async () => {
    const { error } = await owner.client.rpc('remove_profile_and_data', {
      account_id: competitorId,
    });
    expect(error).toBeNull();
    for (const table of ['posts', 'account_metric_snapshots', 'profile_snapshots'] as const) {
      const { count } = await admin
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('social_account_id', competitorId);
      expect(count, table).toBe(0);
    }
    const { count: accounts } = await admin
      .from('social_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('id', competitorId);
    expect(accounts).toBe(0);
  });
});
