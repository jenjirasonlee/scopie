import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FetchLike } from '@/lib/platforms/http';
import { YouTubePublicCollector } from '@/lib/platforms/youtube/public';
import { runSyncJob, type EngineDeps } from '@/lib/sync/engine';
import { enqueueDueJobs } from '@/lib/sync/scheduler';
import { adminClient, cleanup, createOrg, createUser, type TestUser } from '../support/supabase';

const FIXTURES = fileURLToPath(new URL('../fixtures/youtube/', import.meta.url));
const fixture = (name: string) => readFileSync(`${FIXTURES}${name}.json`, 'utf8');
const admin = adminClient();

let owner: TestUser;
let orgId: string;
let channelId: string;

/** The real collector, answering from recorded YouTube responses instead of the network. */
function collector() {
  const fetch: FetchLike = async (input) => {
    const path = new URL(input).pathname;
    const name = path.endsWith('/channels')
      ? 'channel'
      : path.endsWith('/playlistItems')
        ? 'playlist-items'
        : 'videos';
    return new Response(fixture(name), { headers: { 'content-type': 'application/json' } });
  };
  return new YouTubePublicCollector({ fetch, sleep: () => Promise.resolve() });
}

function deps(now: string): EngineDeps {
  return {
    db: admin,
    adapterFor: () => null,
    contextFor: () => Promise.reject(new Error('YouTube public jobs never load an owner token')),
    collectorFor: (platform) => (platform === 'youtube' ? collector() : null),
    // No viewer account, no OAuth: only the server's API key.
    publicContextFor: () =>
      Promise.resolve({ viewerId: null, credential: 'AIzaFixtureKey000000000000000000000000' }),
    now: () => new Date(now),
  };
}

beforeAll(async () => {
  owner = await createUser('youtube-owner');
  orgId = (await createOrg(owner, 'YouTube Watchers')).id;
  const { data, error } = await owner.client
    .from('social_accounts')
    .insert({
      organization_id: orgId,
      platform_key: 'youtube',
      display_name: 'Example Grow',
      handle: 'examplegrow',
      account_type: 'channel',
      business_role: 'competitor',
      country_code: 'NL',
    })
    .select('id')
    .single();
  if (error) throw error;
  channelId = data.id;
});

afterAll(cleanup);

describe('public YouTube channels', () => {
  it('are only scheduled when the server has a YouTube API key', async () => {
    const at = new Date('2026-10-07T06:00:00Z');
    const queued = async () => {
      const { data } = await admin
        .from('sync_runs')
        .select('job_type')
        .eq('social_account_id', channelId)
        .eq('status', 'queued');
      return data!.map((row) => row.job_type).sort();
    };
    await enqueueDueJobs(admin, at);
    expect(await queued()).toEqual([]);
    await enqueueDueJobs(admin, at, { apiKeyPlatforms: ['youtube'] });
    expect(await queued()).toEqual([
      'public_backfill',
      'public_posts_refresh',
      'public_profile_daily',
    ]);
    await admin.from('sync_runs').delete().eq('social_account_id', channelId);
  });

  it('are observed with no OAuth and stored as PUBLIC data', async () => {
    const { data: runId, error } = await owner.client.rpc('request_sync', {
      account_id: channelId,
      job: 'public_profile_daily',
    });
    if (error) throw error;
    const outcome = await runSyncJob(deps('2026-10-07T06:00:00Z'), runId!);
    expect(outcome.status).toBe('succeeded');

    const { data: account } = await owner.client
      .from('social_accounts')
      .select('external_id, access_type, first_observed_at')
      .eq('id', channelId)
      .single();
    expect(account).toMatchObject({
      external_id: 'UCfixture000000000000001',
      access_type: 'public',
    });

    const { data: totals } = await owner.client
      .from('account_metric_snapshots')
      .select('metric_key, value, data_source')
      .eq('social_account_id', channelId)
      .order('metric_key');
    expect(totals).toEqual([
      { metric_key: 'followers', value: 21300, data_source: 'live_public' },
      { metric_key: 'posts_total', value: 240, data_source: 'live_public' },
      { metric_key: 'views', value: 1234567, data_source: 'live_public' },
    ]);
  });

  it('keeps hidden likes and turned-off comments as unavailable, never zero', async () => {
    const { data: post } = await owner.client
      .from('posts')
      .select('id')
      .eq('social_account_id', channelId)
      .eq('external_id', 'vidFixture02')
      .single();
    const { data: metrics } = await owner.client
      .from('post_metric_snapshots')
      .select('metric_key, value, availability')
      .eq('post_id', post!.id)
      .order('metric_key');
    expect(metrics).toEqual([
      { metric_key: 'comments', value: null, availability: 'hidden_by_owner' },
      { metric_key: 'likes', value: null, availability: 'hidden_by_owner' },
      { metric_key: 'views', value: 800, availability: 'available' },
    ]);
  });

  it('never stores an upcoming premiere', async () => {
    const { count } = await owner.client
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('social_account_id', channelId)
      .eq('external_id', 'vidFixture03');
    expect(count).toBe(0);
  });
});
