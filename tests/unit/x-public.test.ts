import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { comparabilityClass, isStorableMetric } from '@/lib/metrics/registry';
import { AuthError, PermissionError, RateLimitError } from '@/lib/platforms/errors';
import type { FetchLike } from '@/lib/platforms/http';
import { redactText } from '@/lib/platforms/http';
import {
  createPublicCollector,
  hasPublicCollector,
  isBilledPublic,
  needsViewer,
} from '@/lib/platforms/registry';
import type { PublicContext } from '@/lib/platforms/types';
import {
  X_MAX_POSTS_PER_RUN,
  XCreditsDepletedError,
  XProfileNotFoundError,
  XProtectedProfileError,
  XPublicCollector,
  normalizeXHandle,
} from '@/lib/platforms/x/public';
import { parseHandleList } from '@/lib/public-data/shared';

const FIXTURES = fileURLToPath(new URL('../fixtures/x/', import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(`${FIXTURES}${name}.json`, 'utf8')) as unknown;

// Shaped like an app-only Bearer token; not a real one.
const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAFixtureToken%2Fnot%3Dreal0000000000';
const ctx: PublicContext = { viewerId: null, credential: TOKEN };

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
function fakeX(route: (url: URL) => Reply) {
  const calls: { url: URL; headers: Headers }[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    const reply = route(url);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json', ...reply.headers },
    });
  };
  const of = (suffix: string) => calls.filter((call) => call.url.pathname.endsWith(suffix));
  return { calls, of, http: { fetch, sleep: () => Promise.resolve() } };
}

const standard = (url: URL): Reply => {
  if (url.pathname.includes('/users/by/username/')) return { status: 200, body: fixture('user') };
  if (url.pathname.endsWith('/tweets') && url.pathname.includes('/users/'))
    return { status: 200, body: fixture('tweets') };
  if (url.pathname === '/2/tweets') return { status: 200, body: fixture('tweets-lookup') };
  throw new Error(`unrouted ${url}`);
};

describe('X handles', () => {
  it('accepts @name, name and x.com or twitter.com links', () => {
    expect(normalizeXHandle('@ExampleGrow')).toBe('ExampleGrow');
    expect(normalizeXHandle(' https://x.com/ExampleGrow/status/123 ')).toBe('ExampleGrow');
    expect(normalizeXHandle('https://twitter.com/example_grow?lang=en')).toBe('example_grow');
    expect(normalizeXHandle('https://mobile.twitter.com/examplegrow')).toBe('examplegrow');
  });

  it('reads pasted lists for X, rejecting names X does not allow', () => {
    const { handles, invalid } = parseHandleList(
      'username\n@rival_one,NL\nhttps://x.com/rival_two\nthis-name-is-far-too-long',
      'x',
    );
    expect(handles).toEqual([
      { handle: 'rival_one', countryCode: 'NL' },
      { handle: 'rival_two', countryCode: null },
    ]);
    expect(invalid).toEqual(['this-name-is-far-too-long']);
  });
});

describe('X public collector', () => {
  it('sends the Bearer token in a header, never in the URL, and asks for public fields', async () => {
    const x = fakeX(standard);
    await new XPublicCollector(x.http).lookupProfile(ctx, '@ExampleGrow');
    const { url, headers } = x.calls[0]!;
    expect(url.pathname).toBe('/2/users/by/username/ExampleGrow');
    expect(url.searchParams.get('user.fields')).toContain('public_metrics');
    expect(url.searchParams.get('user.fields')).toContain('protected');
    expect(url.toString()).not.toContain(TOKEN);
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('maps the profile and its totals', async () => {
    const x = fakeX(standard);
    const { profile, accountMetrics } = await new XPublicCollector(x.http).lookupProfile(
      ctx,
      'examplegrow',
    );
    expect(profile).toEqual({
      externalId: '1500000000000000001',
      username: 'ExampleGrow',
      displayName: 'Example Grow (fixture)',
      biography: 'Fixture account for tests. Not a real account. #hydroponics',
      // The t.co link is expanded to the real website.
      website: 'https://example.com/grow',
      profilePictureUrl: 'https://pbs.twimg.example/profile_images/fixture_normal.jpg',
    });
    expect(accountMetrics).toEqual([
      expect.objectContaining({ metricKey: 'followers', value: 18450, availability: 'available' }),
      expect.objectContaining({ metricKey: 'following', value: 312 }),
      expect.objectContaining({
        metricKey: 'posts_total',
        sourceMetric: 'public_metrics.tweet_count',
        value: 5120,
      }),
    ]);
  });

  it('reports missing totals as unavailable, never zero', async () => {
    const x = fakeX(() => ({ status: 200, body: fixture('user-no-metrics') }));
    const { accountMetrics } = await new XPublicCollector(x.http).lookupProfile(ctx, 'NoMetrics');
    expect(accountMetrics.map((m) => [m.metricKey, m.value, m.availability])).toEqual([
      ['followers', null, 'not_public'],
      ['following', null, 'not_public'],
      ['posts_total', null, 'not_public'],
    ]);
  });

  it('reads the first window of own posts (no replies, no reposts) with their public metrics', async () => {
    const x = fakeX(standard);
    const collector = new XPublicCollector(x.http);
    const startTime = '2026-09-07T06:00:00.000Z';
    const observation = await collector.observeProfile(ctx, 'ExampleGrow', '2026-10-07', {
      sinceId: null,
      startTime,
      recheckIds: [],
    });
    const timeline = x.of('/users/1500000000000000001/tweets')[0]!.url.searchParams;
    expect(timeline.get('start_time')).toBe(startTime);
    expect(timeline.get('since_id')).toBeNull();
    expect(timeline.get('exclude')).toBe('retweets,replies');
    expect(timeline.get('max_results')).toBe(String(X_MAX_POSTS_PER_RUN));
    expect(timeline.get('expansions')).toBe('attachments.media_keys');
    expect(x.of('/2/tweets')).toHaveLength(0);

    const posts = observation.firstPage.posts;
    expect(posts.map((post) => [post.externalId, post.mediaFormat, post.nativeType])).toEqual([
      ['1840000000000000003', 'image', 'tweet'],
      ['1840000000000000002', 'video', 'quote'],
      ['1840000000000000001', 'text', 'tweet'],
    ]);
    expect(posts[0]!.permalink).toBe('https://x.com/ExampleGrow/status/1840000000000000003');
    const first = observation.firstPage.metrics.filter(
      (m) => m.postExternalId === '1840000000000000003',
    );
    expect(first.map((m) => [m.metricKey, m.value])).toEqual([
      ['likes', 88],
      ['comments', 4],
      ['shares', 12],
      ['quotes', 2],
      ['saves', 9],
      ['views', 5400],
    ]);
    // The oldest post came back without an impression count: unavailable, not 0.
    expect(
      observation.firstPage.metrics.find(
        (m) => m.postExternalId === '1840000000000000001' && m.metricKey === 'views',
      ),
    ).toMatchObject({ value: null, availability: 'not_public' });
    // Every post since the window start was read, so history counts from there.
    expect(observation.completeFrom).toBe(startTime);
    expect(observation.removedPostIds).toEqual([]);
    expect(collector.usersRead).toBe(1);
    expect(collector.postsRead).toBe(3);
    expect(collector.estimatedCostUsd).toBeCloseTo(0.025);
  });

  it('later reads only newer posts, re-reads due posts and reports deleted ones', async () => {
    const x = fakeX(standard);
    const collector = new XPublicCollector(x.http);
    const observation = await collector.observeProfile(ctx, 'ExampleGrow', '2026-10-08', {
      sinceId: '1840000000000000003',
      startTime: '2026-09-08T06:00:00.000Z',
      recheckIds: ['1840000000000000001', '1840000000000000002'],
    });
    const timeline = x.of('/users/1500000000000000001/tweets')[0]!.url.searchParams;
    expect(timeline.get('since_id')).toBe('1840000000000000003');
    expect(timeline.get('start_time')).toBeNull();
    expect(timeline.get('max_results')).toBe(String(X_MAX_POSTS_PER_RUN - 2));
    const lookup = x.of('/2/tweets')[0]!.url.searchParams;
    expect(lookup.get('ids')).toBe('1840000000000000001,1840000000000000002');
    // 1840000000000000001 was deleted on X: it must be deleted in Scopie too.
    expect(observation.removedPostIds).toEqual(['1840000000000000001']);
    const reread = observation.firstPage.metrics.filter(
      (m) => m.postExternalId === '1840000000000000002' && m.metricKey === 'likes',
    );
    expect(reread.map((m) => m.value)).toContain(310);
    // Nothing was cut off, so the history start doesn't move.
    expect(observation.completeFrom).toBeUndefined();
  });

  it('never reads more than the per-run cap', async () => {
    const x = fakeX((url) =>
      url.pathname === '/2/tweets'
        ? { status: 200, body: { data: [] } }
        : url.pathname.endsWith('/tweets')
          ? { status: 200, body: fixture('tweets-more') }
          : standard(url),
    );
    const collector = new XPublicCollector(x.http);
    const recheckIds = Array.from({ length: 80 }, (_, i) =>
      String(1830000000000000000n + BigInt(i)),
    );
    const observation = await collector.observeProfile(ctx, 'ExampleGrow', '2026-10-08', {
      sinceId: '1840000000000000003',
      startTime: '2026-09-08T06:00:00.000Z',
      recheckIds,
    });
    const ids = x.of('/2/tweets')[0]!.url.searchParams.get('ids')!.split(',');
    const asked = x
      .of('/users/1500000000000000001/tweets')
      .map((call) => Number(call.url.searchParams.get('max_results')));
    expect(ids.length + asked.reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(
      X_MAX_POSTS_PER_RUN,
    );
    expect(ids).toHaveLength(X_MAX_POSTS_PER_RUN - 5);
    // More new posts were waiting: history counts from the oldest one read, never as "no posts".
    expect(observation.completeFrom).toBe('2026-10-08T12:00:00.000Z');
  });

  it('stops after a few requests when X keeps returning short pages', async () => {
    const x = fakeX((url) =>
      url.pathname.endsWith('/tweets')
        ? { status: 200, body: fixture('tweets-more') }
        : standard(url),
    );
    await new XPublicCollector(x.http).observeProfile(ctx, 'ExampleGrow', '2026-10-08', {
      sinceId: null,
      startTime: '2026-09-08T06:00:00.000Z',
      recheckIds: [],
    });
    expect(x.of('/users/1500000000000000001/tweets')).toHaveLength(3);
    expect(
      x.of('/users/1500000000000000001/tweets')[1]!.url.searchParams.get('pagination_token'),
    ).toBe('7140dibdnow9c7btw4b0q2eqs1vaqkqmcwmn8mrd2s3m');
  });

  it('refuses protected accounts and reads none of their posts', async () => {
    const x = fakeX(() => ({ status: 200, body: fixture('user-protected') }));
    const collector = new XPublicCollector(x.http);
    await expect(
      collector.observeProfile(ctx, 'PrivateGrower', '2026-10-07'),
    ).rejects.toBeInstanceOf(XProtectedProfileError);
    await expect(collector.lookupProfile(ctx, 'PrivateGrower')).rejects.toMatchObject({
      code: 'profile_protected',
      message: expect.stringMatching(/protected X account/),
    });
    expect(x.calls.every((call) => call.url.pathname.includes('/users/by/'))).toBe(true);
  });

  it('says when a profile does not exist or is suspended', async () => {
    const missing = fakeX(() => ({ status: 200, body: fixture('user-not-found') }));
    await expect(
      new XPublicCollector(missing.http).lookupProfile(ctx, 'nobody_here'),
    ).rejects.toMatchObject({
      code: 'profile_not_found',
      message: 'X has no public account "@nobody_here".',
    });
    const suspended = fakeX(() => ({ status: 200, body: fixture('user-suspended') }));
    await expect(
      new XPublicCollector(suspended.http).lookupProfile(ctx, 'suspended_one'),
    ).rejects.toMatchObject({ message: expect.stringMatching(/suspended/) });
    const invalid = fakeX(standard);
    await expect(
      new XPublicCollector(invalid.http).lookupProfile(ctx, 'not a handle!'),
    ).rejects.toBeInstanceOf(XProfileNotFoundError);
    expect(invalid.calls).toHaveLength(0);
  });

  it('turns HTTP errors into typed errors', async () => {
    const run = (reply: Reply) =>
      new XPublicCollector(fakeX(() => reply).http).lookupProfile(ctx, 'ExampleGrow');
    await expect(run({ status: 401, body: fixture('error-unauthorized') })).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(run({ status: 403, body: fixture('error-forbidden') })).rejects.toBeInstanceOf(
      PermissionError,
    );
    const reset = String(Math.floor(Date.now() / 1000) + 600);
    const limited = run({
      status: 429,
      body: fixture('error-rate-limit'),
      headers: { 'x-rate-limit-reset': reset },
    });
    await expect(limited).rejects.toBeInstanceOf(RateLimitError);
    await expect(limited).rejects.toMatchObject({
      retryAfterSeconds: expect.any(Number) as number,
    });
    const wait = await limited.catch((error: RateLimitError) => error.retryAfterSeconds);
    expect(wait).toBeGreaterThan(500);
    expect(wait).toBeLessThanOrEqual(600);
    const credits = run({ status: 402, body: fixture('error-credits') });
    await expect(credits).rejects.toBeInstanceOf(XCreditsDepletedError);
    await expect(credits).rejects.toMatchObject({
      code: 'credits_depleted',
      message: expect.stringMatching(/X credits are used up/),
    });
  });

  it('needs the server key', async () => {
    const x = fakeX(standard);
    await expect(
      new XPublicCollector(x.http).lookupProfile({ viewerId: null, credential: '' }, 'ExampleGrow'),
    ).rejects.toMatchObject({ code: 'no_api_key' });
    expect(x.calls).toHaveLength(0);
  });

  it('keeps no post text in raw payloads, and redacts tokens from text', async () => {
    const x = fakeX(standard);
    const collector = new XPublicCollector(x.http);
    await collector.observeProfile(ctx, 'ExampleGrow', '2026-10-07');
    const raw = JSON.stringify(collector.drainRawPayloads());
    expect(raw).not.toContain('Autumn feeding guide');
    expect(raw).not.toContain(TOKEN);
    expect(redactText(`Authorization: Bearer ${TOKEN}`)).not.toContain('FixtureToken');
    expect(redactText(`token ${TOKEN} leaked`)).toBe('token REDACTED leaked');
  });
});

describe('X in the registry', () => {
  it('is a public platform read with a server key, billed per read', () => {
    expect(hasPublicCollector('x')).toBe(true);
    expect(needsViewer('x')).toBe(false);
    expect(isBilledPublic('x')).toBe(true);
    const collector = createPublicCollector('x');
    expect(collector).toBeInstanceOf(XPublicCollector);
    expect(collector?.billedPerRead).toBe(true);
  });

  it('keeps X numbers in their own comparability classes where they differ', () => {
    expect(comparabilityClass('x', 'post', 'views')).toBe('x_public_views');
    expect(comparabilityClass('x', 'post', 'saves')).toBe('x_bookmarks');
    expect(comparabilityClass('x', 'account', 'posts_total')).toBe('x_tweet_count');
    expect(comparabilityClass('x', 'post', 'likes')).toBe('likes');
    expect(isStorableMetric('quotes', 'post')).toBe(true);
  });
});
