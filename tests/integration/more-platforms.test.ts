import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BlueskyPublicCollector } from '@/lib/platforms/bluesky/public';
import type { FetchLike } from '@/lib/platforms/http';
import { XPublicCollector } from '@/lib/platforms/x/public';
import { runSyncJob, type EngineDeps } from '@/lib/sync/engine';
import { enqueueDueJobs } from '@/lib/sync/scheduler';
import { adminClient, cleanup, createOrg, createUser, type TestUser } from '../support/supabase';

const read = (dir: string, name: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../fixtures/${dir}/${name}.json`, import.meta.url)),
      'utf8',
    ),
  ) as Record<string, unknown>;
const admin = adminClient();
const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAFixtureToken%2Fnot%3Dreal0000000000';

let owner: TestUser;
let orgId: string;
let xId: string;
let blueskyId: string;

/** Posts "deleted on X" since the last read: the lookup no longer returns them. */
const deletedOnX = new Set<string>();
const xCalls: URL[] = [];

/** The real X collector, answering from recorded responses instead of the network. */
function xCollector() {
  const fetch: FetchLike = async (input) => {
    const url = new URL(input);
    xCalls.push(url);
    let body: unknown;
    if (url.pathname.includes('/users/by/username/')) body = read('x', 'user');
    else if (url.pathname.endsWith('/tweets') && url.pathname.includes('/users/')) {
      body = read('x', url.searchParams.get('since_id') ? 'tweets-empty' : 'tweets');
    } else {
      const ids = url.searchParams.get('ids')!.split(',');
      const all = read('x', 'tweets') as { data: { id: string }[] };
      body = {
        data: all.data.filter((t) => ids.includes(t.id) && !deletedOnX.has(t.id)),
        errors: ids
          .filter((id) => deletedOnX.has(id))
          .map((id) => ({
            value: id,
            title: 'Not Found Error',
            detail: `Could not find tweet with ids: [${id}].`,
            type: 'https://api.twitter.com/2/problems/resource-not-found',
          })),
      };
    }
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  return new XPublicCollector({ fetch, sleep: () => Promise.resolve() });
}

function blueskyCollector() {
  const fetch: FetchLike = async (input) => {
    const url = new URL(input);
    const name = url.pathname.endsWith('getProfile')
      ? 'profile'
      : url.searchParams.get('cursor')
        ? 'author-feed-end'
        : 'author-feed';
    return new Response(JSON.stringify(read('bluesky', name)), {
      headers: { 'content-type': 'application/json' },
    });
  };
  return new BlueskyPublicCollector({ fetch, sleep: () => Promise.resolve() });
}

function deps(now: string): EngineDeps {
  return {
    db: admin,
    adapterFor: () => null,
    contextFor: () => Promise.reject(new Error('Public jobs never load an owner token')),
    collectorFor: (platform) =>
      platform === 'x' ? xCollector() : platform === 'bluesky' ? blueskyCollector() : null,
    publicContextFor: (_org, platform) =>
      Promise.resolve({ viewerId: null, credential: platform === 'x' ? TOKEN : '' }),
    now: () => new Date(now),
  };
}

async function run(accountId: string, now: string) {
  const { data: runId, error } = await owner.client.rpc('request_sync', {
    account_id: accountId,
    job: 'public_profile_daily',
  });
  if (error) throw error;
  return { runId: runId!, outcome: await runSyncJob(deps(now), runId!) };
}

async function addProfile(platform: string, handle: string) {
  const { data, error } = await owner.client
    .from('social_accounts')
    .insert({
      organization_id: orgId,
      platform_key: platform,
      display_name: handle,
      handle,
      account_type: 'profile',
      business_role: 'competitor',
      country_code: 'NL',
    })
    .select('id, access_type')
    .single();
  if (error) throw error;
  expect(data.access_type).toBe('public');
  return data.id;
}

beforeAll(async () => {
  owner = await createUser('more-platforms-owner');
  orgId = (await createOrg(owner, 'More Platforms Watchers')).id;
  xId = await addProfile('x', 'ExampleGrow');
  blueskyId = await addProfile('bluesky', 'examplegrow.bsky.social');
});

afterAll(async () => {
  // Bluesky profiles are scheduled with no key, so leave none behind for other test files.
  for (const id of [xId, blueskyId]) {
    if (id) await owner.client.rpc('remove_profile_and_data', { account_id: id });
  }
  await cleanup();
});

describe('scheduling', () => {
  it('reads Bluesky with no key, X only with a key and only once a day', async () => {
    const at = new Date('2026-10-07T06:00:00Z');
    const queued = async (id: string) => {
      const { data } = await admin
        .from('sync_runs')
        .select('job_type')
        .eq('social_account_id', id)
        .eq('status', 'queued');
      return data!.map((row) => row.job_type).sort();
    };
    await enqueueDueJobs(admin, at);
    expect(await queued(blueskyId)).toEqual([
      'public_backfill',
      'public_posts_refresh',
      'public_profile_daily',
    ]);
    expect(await queued(xId)).toEqual([]);
    await enqueueDueJobs(admin, at, { apiKeyPlatforms: ['x'] });
    // X bills every read: no refresh or backfill jobs.
    expect(await queued(xId)).toEqual(['public_profile_daily']);
    await admin.from('sync_runs').delete().in('social_account_id', [xId, blueskyId]);
  });
});

describe('public Bluesky profiles', () => {
  it('are observed with no key and stored as PUBLIC data, unavailable never as zero', async () => {
    const { outcome } = await run(blueskyId, '2026-10-07T06:00:00Z');
    expect(outcome.status).toBe('succeeded');
    const { data: account } = await owner.client
      .from('social_accounts')
      .select('external_id, first_observed_at')
      .eq('id', blueskyId)
      .single();
    expect(account?.external_id).toBe('did:plc:fixture2grow4example7bsk');
    const { data: totals } = await owner.client
      .from('account_metric_snapshots')
      .select('metric_key, value, data_source')
      .eq('social_account_id', blueskyId)
      .order('metric_key');
    expect(totals).toEqual([
      { metric_key: 'followers', value: 3120, data_source: 'live_public' },
      { metric_key: 'following', value: 210, data_source: 'live_public' },
      { metric_key: 'posts_total', value: 845, data_source: 'live_public' },
    ]);
    const { data: posts } = await owner.client
      .from('posts')
      .select('id, external_id, media_format')
      .eq('social_account_id', blueskyId)
      .order('published_at', { ascending: false });
    expect(posts!.map((post) => post.media_format)).toEqual(['image', 'video', 'link', 'image']);
    const { data: quotes } = await owner.client
      .from('post_metric_snapshots')
      .select('value, availability')
      .eq('post_id', posts![1]!.id)
      .eq('metric_key', 'quotes');
    expect(quotes).toEqual([{ value: null, availability: 'not_public' }]);
  });
});

describe('public X profiles', () => {
  it('first read: profile, posts of the last 30 days and where post history starts', async () => {
    const { outcome } = await run(xId, '2026-10-07T06:00:00Z');
    expect(outcome.status).toBe('succeeded');
    const timeline = xCalls.find(
      (url) => url.pathname.endsWith('/tweets') && url.pathname.includes('/users/'),
    )!;
    expect(timeline.searchParams.get('start_time')).toBe('2026-09-07T06:00:00.000Z');
    const { data: account } = await owner.client
      .from('social_accounts')
      .select('external_id, earliest_post_at')
      .eq('id', xId)
      .single();
    expect(account).toEqual({
      external_id: '1500000000000000001',
      earliest_post_at: '2026-09-07T06:00:00+00:00',
    });
    const { count } = await owner.client
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('social_account_id', xId);
    expect(count).toBe(3);
  });

  it('later reads only new posts, re-reads due ones, and deletes posts deleted on X', async () => {
    const { data: doomed } = await admin
      .from('posts')
      .select('id')
      .eq('social_account_id', xId)
      .eq('external_id', '1840000000000000003')
      .single();
    deletedOnX.add('1840000000000000003');
    xCalls.length = 0;
    const { runId, outcome } = await run(xId, '2026-10-08T07:00:00Z');
    expect(outcome.status).toBe('succeeded');
    const timeline = xCalls.find(
      (url) => url.pathname.endsWith('/tweets') && url.pathname.includes('/users/'),
    )!;
    expect(timeline.searchParams.get('since_id')).toBe('1840000000000000003');
    expect(timeline.searchParams.get('start_time')).toBeNull();
    // Only posts that reached a capture age (1 and 3 days) are re-read; the 6-day-old one isn't.
    const lookup = xCalls.find((url) => url.pathname === '/2/tweets')!;
    expect(lookup.searchParams.get('ids')!.split(',').sort()).toEqual([
      '1840000000000000002',
      '1840000000000000003',
    ]);

    const { data: posts } = await admin
      .from('posts')
      .select('id, external_id')
      .eq('social_account_id', xId);
    expect(posts!.map((post) => post.external_id).sort()).toEqual([
      '1840000000000000001',
      '1840000000000000002',
    ]);
    // Its metrics went with it.
    const { count: leftover } = await admin
      .from('post_metric_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('post_id', doomed!.id);
    expect(leftover).toBe(0);
    const { data: events } = await admin
      .from('sync_run_events')
      .select('code')
      .eq('sync_run_id', runId);
    expect(events!.map((event) => event.code)).toContain('posts_removed');
    // History still counts from the first read: nothing was cut off.
    const { data: account } = await admin
      .from('social_accounts')
      .select('earliest_post_at')
      .eq('id', xId)
      .single();
    expect(account?.earliest_post_at).toBe('2026-09-07T06:00:00+00:00');
  });
});
