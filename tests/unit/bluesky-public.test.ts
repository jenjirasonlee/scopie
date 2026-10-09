import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { comparabilityClass } from '@/lib/metrics/registry';
import {
  BlueskyHiddenProfileError,
  BlueskyProfileNotFoundError,
  BlueskyPublicCollector,
  isBlueskyHandle,
  normalizeBlueskyHandle,
} from '@/lib/platforms/bluesky/public';
import { PermissionError, PlatformError, RateLimitError } from '@/lib/platforms/errors';
import type { FetchLike } from '@/lib/platforms/http';
import {
  createPublicCollector,
  hasPublicCollector,
  isBilledPublic,
  isKeylessPublic,
  needsViewer,
} from '@/lib/platforms/registry';
import type { PublicContext } from '@/lib/platforms/types';
import { parseHandleList } from '@/lib/public-data/shared';

const FIXTURES = fileURLToPath(new URL('../fixtures/bluesky/', import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(`${FIXTURES}${name}.json`, 'utf8')) as unknown;

// Bluesky needs no key: the context carries none.
const ctx: PublicContext = { viewerId: null, credential: '' };
const DID = 'did:plc:fixture2grow4example7bsk';

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
function fakeBluesky(route: (url: URL) => Reply) {
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
  const of = (method: string) => calls.filter((call) => call.url.pathname.endsWith(method));
  return { calls, of, http: { fetch, sleep: () => Promise.resolve() } };
}

const standard = (url: URL): Reply => {
  if (url.pathname.endsWith('app.bsky.actor.getProfile'))
    return { status: 200, body: fixture('profile') };
  if (url.pathname.endsWith('app.bsky.feed.getAuthorFeed'))
    return {
      status: 200,
      body: fixture(url.searchParams.get('cursor') ? 'author-feed-end' : 'author-feed'),
    };
  throw new Error(`unrouted ${url}`);
};

describe('Bluesky handles', () => {
  it('accepts @handle, the handle, a custom domain, a DID or a bsky.app link', () => {
    expect(normalizeBlueskyHandle('@ExampleGrow.bsky.social')).toBe('examplegrow.bsky.social');
    expect(normalizeBlueskyHandle('https://bsky.app/profile/brand.com/post/3lfix')).toBe(
      'brand.com',
    );
    expect(normalizeBlueskyHandle(`https://bsky.app/profile/${DID}`)).toBe(DID);
    // A bare name means a bsky.social handle.
    expect(normalizeBlueskyHandle('@brand')).toBe('brand.bsky.social');
    expect(isBlueskyHandle('brand.bsky.social')).toBe(true);
    expect(isBlueskyHandle(DID)).toBe(true);
    expect(isBlueskyHandle('not a handle')).toBe(false);
    expect(isBlueskyHandle('under_score.bsky.social')).toBe(false);
  });

  it('reads pasted lists for Bluesky', () => {
    const { handles, invalid } = parseHandleList(
      'handle\nrival.bsky.social,NL\nhttps://bsky.app/profile/brand.com\nbad_name!',
      'bluesky',
    );
    expect(handles).toEqual([
      { handle: 'rival.bsky.social', countryCode: 'NL' },
      { handle: 'brand.com', countryCode: null },
    ]);
    expect(invalid).toEqual(['bad_name!']);
  });
});

describe('Bluesky public collector', () => {
  it('reads the public AppView with no key and no login', async () => {
    const bsky = fakeBluesky(standard);
    await new BlueskyPublicCollector(bsky.http).lookupProfile(ctx, '@examplegrow.bsky.social');
    const { url, headers } = bsky.calls[0]!;
    expect(url.origin).toBe('https://public.api.bsky.app');
    expect(url.pathname).toBe('/xrpc/app.bsky.actor.getProfile');
    expect(url.searchParams.get('actor')).toBe('examplegrow.bsky.social');
    expect(headers.get('authorization')).toBeNull();
  });

  it('maps the profile, its totals and the newest page of own posts', async () => {
    const bsky = fakeBluesky(standard);
    const observation = await new BlueskyPublicCollector(bsky.http).observeProfile(
      ctx,
      'examplegrow.bsky.social',
      '2026-10-07',
    );
    expect(observation.profile).toMatchObject({
      externalId: DID,
      username: 'examplegrow.bsky.social',
      displayName: 'Example Grow (fixture)',
      website: null,
    });
    expect(observation.accountMetrics.map((m) => [m.metricKey, m.value, m.metricDate])).toEqual([
      ['followers', 3120, '2026-10-07'],
      ['following', 210, '2026-10-07'],
      ['posts_total', 845, '2026-10-07'],
    ]);
    const feed = bsky.of('app.bsky.feed.getAuthorFeed')[0]!.url.searchParams;
    expect(feed.get('actor')).toBe(DID);
    expect(feed.get('filter')).toBe('posts_no_replies');
    expect(feed.get('limit')).toBe('100');

    const posts = observation.firstPage.posts;
    // The repost of someone else's post is skipped.
    expect(posts.map((post) => [post.externalId.split('/').at(-1), post.mediaFormat])).toEqual([
      ['3lfix0000004', 'image'],
      ['3lfix0000003', 'video'],
      ['3lfix0000002', 'link'],
      ['3lfix0000001', 'image'],
    ]);
    expect(posts[0]).toMatchObject({
      externalId: `at://${DID}/app.bsky.feed.post/3lfix0000004`,
      publishedAt: '2026-10-06T09:15:00.000Z',
      permalink: 'https://bsky.app/profile/examplegrow.bsky.social/post/3lfix0000004',
      caption: 'Autumn feeding guide is out. #growtips',
      nativeType: 'app.bsky.embed.images',
    });
    expect(observation.firstPage.nextCursor).toBe('2026-10-02T07:30:00.000Z');
  });

  it('reports likes, replies, reposts and quotes; a missing count is unavailable, never 0', async () => {
    const bsky = fakeBluesky(standard);
    const { firstPage } = await new BlueskyPublicCollector(bsky.http).observeProfile(
      ctx,
      'examplegrow.bsky.social',
      '2026-10-07',
    );
    const video = firstPage.metrics.filter((m) => m.postExternalId.endsWith('3lfix0000003'));
    expect(video.map((m) => [m.metricKey, m.value, m.availability])).toEqual([
      ['likes', 240, 'available'],
      ['comments', 0, 'available'],
      ['shares', 30, 'available'],
      ['quotes', null, 'not_public'],
    ]);
    // Bluesky has no view counts: none are invented.
    expect(firstPage.metrics.some((m) => m.metricKey === 'views')).toBe(false);
  });

  it('reports missing profile totals as unavailable', async () => {
    const bsky = fakeBluesky(() => ({ status: 200, body: fixture('profile-no-counts') }));
    const { accountMetrics } = await new BlueskyPublicCollector(bsky.http).lookupProfile(
      ctx,
      'nocounts.example.com',
    );
    expect(accountMetrics.every((m) => m.value === null && m.availability === 'not_public')).toBe(
      true,
    );
  });

  it('continues from the cursor, reusing the DID, and ends with the feed', async () => {
    const bsky = fakeBluesky(standard);
    const collector = new BlueskyPublicCollector(bsky.http);
    await collector.observeProfile(ctx, 'examplegrow.bsky.social', '2026-10-07');
    const page = await collector.listPosts(
      ctx,
      'examplegrow.bsky.social',
      '2026-10-02T07:30:00.000Z',
    );
    const feeds = bsky.of('app.bsky.feed.getAuthorFeed');
    expect(feeds[1]!.url.searchParams.get('cursor')).toBe('2026-10-02T07:30:00.000Z');
    expect(bsky.of('app.bsky.actor.getProfile')).toHaveLength(1);
    // A quote post with no media is text.
    expect(page.posts.map((post) => post.mediaFormat)).toEqual(['text']);
    expect(page.nextCursor).toBeNull();
  });

  it('does not read accounts that ask apps not to show them to logged-out people', async () => {
    const bsky = fakeBluesky(() => ({ status: 200, body: fixture('profile-hidden') }));
    await expect(
      new BlueskyPublicCollector(bsky.http).observeProfile(
        ctx,
        'quietgrower.bsky.social',
        '2026-10-07',
      ),
    ).rejects.toBeInstanceOf(BlueskyHiddenProfileError);
    expect(bsky.of('app.bsky.feed.getAuthorFeed')).toHaveLength(0);
  });

  it('says when a profile does not exist or was taken down', async () => {
    const missing = fakeBluesky(() => ({ status: 400, body: fixture('error-not-found') }));
    await expect(
      new BlueskyPublicCollector(missing.http).lookupProfile(ctx, 'nobody.bsky.social'),
    ).rejects.toMatchObject({
      code: 'profile_not_found',
      message: 'Bluesky has no public account "@nobody.bsky.social".',
    });
    const takedown = fakeBluesky(() => ({ status: 400, body: fixture('error-takedown') }));
    await expect(
      new BlueskyPublicCollector(takedown.http).lookupProfile(ctx, 'gone.bsky.social'),
    ).rejects.toBeInstanceOf(BlueskyProfileNotFoundError);
    const invalid = fakeBluesky(standard);
    await expect(
      new BlueskyPublicCollector(invalid.http).lookupProfile(ctx, 'not a handle'),
    ).rejects.toBeInstanceOf(BlueskyProfileNotFoundError);
    expect(invalid.calls).toHaveLength(0);
  });

  it('waits as long as Bluesky asks when rate limited', async () => {
    const after = fakeBluesky(() => ({
      status: 429,
      body: fixture('error-rate-limit'),
      headers: { 'retry-after': '120' },
    }));
    await expect(
      new BlueskyPublicCollector(after.http).lookupProfile(ctx, 'examplegrow.bsky.social'),
    ).rejects.toMatchObject({ retryAfterSeconds: 120 });
    const reset = fakeBluesky(() => ({
      status: 429,
      body: fixture('error-rate-limit'),
      headers: { 'ratelimit-reset': String(Math.floor(Date.now() / 1000) + 300) },
    }));
    const error = await new BlueskyPublicCollector(reset.http)
      .lookupProfile(ctx, 'examplegrow.bsky.social')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterSeconds).toBeGreaterThan(200);
  });

  it('turns other errors into typed errors', async () => {
    const forbidden = fakeBluesky(() => ({
      status: 403,
      body: { error: 'Forbidden', message: 'nope' },
    }));
    await expect(
      new BlueskyPublicCollector(forbidden.http).lookupProfile(ctx, 'examplegrow.bsky.social'),
    ).rejects.toBeInstanceOf(PermissionError);
    const odd = fakeBluesky(() => ({
      status: 400,
      body: { error: 'InvalidRequest', message: 'bad' },
    }));
    await expect(
      new BlueskyPublicCollector(odd.http).lookupProfile(ctx, 'examplegrow.bsky.social'),
    ).rejects.toMatchObject({ code: 'platform_error' });
    const shape = fakeBluesky(() => ({ status: 200, body: { handle: 'x.bsky.social' } }));
    await expect(
      new BlueskyPublicCollector(shape.http).lookupProfile(ctx, 'examplegrow.bsky.social'),
    ).rejects.toBeInstanceOf(PlatformError);
  });
});

describe('Bluesky profile search', () => {
  it('finds profiles by name with no key, then reads their public follower counts', async () => {
    const profile = fixture('profile') as Record<string, unknown>;
    const hidden = fixture('profile-hidden') as Record<string, unknown>;
    const bsky = fakeBluesky((url) => {
      if (url.pathname.endsWith('app.bsky.actor.searchActorsTypeahead'))
        return {
          status: 200,
          body: {
            actors: [
              { did: DID, handle: 'examplegrow.bsky.social' },
              { did: 'did:plc:hiddenlabel000000000000', labels: [{ val: '!no-unauthenticated' }] },
            ],
          },
        };
      if (url.pathname.endsWith('app.bsky.actor.getProfiles'))
        return { status: 200, body: { profiles: [profile, hidden] } };
      throw new Error(`unrouted ${url}`);
    });
    const hits = await new BlueskyPublicCollector(bsky.http).searchProfiles(ctx, 'example grow', 8);
    expect(bsky.of('searchActorsTypeahead')[0]!.url.searchParams.get('q')).toBe('example grow');
    // Accounts that ask not to be shown to logged-out people are never looked up or shown.
    expect(bsky.of('getProfiles')[0]!.url.searchParams.getAll('actors')).toEqual([DID]);
    expect(hits).toEqual([
      {
        externalId: DID,
        username: 'examplegrow.bsky.social',
        displayName: 'Example Grow (fixture)',
        profilePictureUrl: profile.avatar,
        followers: profile.followersCount ?? null,
      },
    ]);
    expect(bsky.calls.every((call) => !call.headers.get('authorization'))).toBe(true);
  });
});

describe('Bluesky in the registry', () => {
  it('is a public platform that needs no key and no viewer', () => {
    expect(hasPublicCollector('bluesky')).toBe(true);
    expect(needsViewer('bluesky')).toBe(false);
    expect(isKeylessPublic('bluesky')).toBe(true);
    expect(isBilledPublic('bluesky')).toBe(false);
    expect(createPublicCollector('bluesky')).toBeInstanceOf(BlueskyPublicCollector);
    expect(comparabilityClass('bluesky', 'post', 'shares')).toBe('reposts');
    expect(comparabilityClass('bluesky', 'account', 'posts_total')).toBe('bsky_posts_count');
  });
});
