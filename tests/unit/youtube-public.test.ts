import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AuthError, RateLimitError } from '@/lib/platforms/errors';
import type { FetchLike } from '@/lib/platforms/http';
import { redactText } from '@/lib/platforms/http';
import { comparabilityClass } from '@/lib/metrics/registry';
import { createPublicCollector, needsViewer } from '@/lib/platforms/registry';
import {
  ChannelNotFoundError,
  YouTubePublicCollector,
  normalizeYouTubeHandle,
} from '@/lib/platforms/youtube/public';
import type { PublicContext } from '@/lib/platforms/types';
import { parseHandleList } from '@/lib/public-data/shared';

const FIXTURES = fileURLToPath(new URL('../fixtures/youtube/', import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(`${FIXTURES}${name}.json`, 'utf8')) as unknown;

const KEY = 'AIzaFixtureKey000000000000000000000000';
const ctx: PublicContext = { viewerId: null, credential: KEY };

type Reply = { status: number; body: unknown };
function fakeYouTube(route: (url: URL) => Reply) {
  const calls: { url: URL; headers: Headers }[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    const reply = route(url);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, http: { fetch, sleep: () => Promise.resolve() } };
}

const standard = (url: URL): Reply => {
  if (url.pathname.endsWith('/channels')) return { status: 200, body: fixture('channel') };
  if (url.pathname.endsWith('/playlistItems'))
    return { status: 200, body: fixture('playlist-items') };
  if (url.pathname.endsWith('/videos')) return { status: 200, body: fixture('videos') };
  throw new Error(`unrouted ${url}`);
};

describe('YouTube public collector', () => {
  it('reads a channel by handle with an API key in a header, never in the URL', async () => {
    const yt = fakeYouTube(standard);
    await new YouTubePublicCollector(yt.http).lookupProfile(ctx, '@examplegrow');
    const { url, headers } = yt.calls[0]!;
    expect(url.searchParams.get('forHandle')).toBe('@examplegrow');
    expect(url.toString()).not.toContain(KEY);
    expect(headers.get('x-goog-api-key')).toBe(KEY);
  });

  it('accepts channel links and channel ids', async () => {
    expect(normalizeYouTubeHandle('https://www.youtube.com/@examplegrow/videos')).toBe(
      'examplegrow',
    );
    const yt = fakeYouTube(standard);
    await new YouTubePublicCollector(yt.http).lookupProfile(
      ctx,
      'https://www.youtube.com/channel/UCfixture000000000000001',
    );
    expect(yt.calls[0]!.url.searchParams.get('id')).toBe('UCfixture000000000000001');
  });

  it('maps the channel, its totals and one page of videos in three quota units', async () => {
    const yt = fakeYouTube(standard);
    const collector = new YouTubePublicCollector(yt.http);
    const observation = await collector.observeProfile(ctx, 'examplegrow', '2026-10-07');
    expect(observation.profile).toMatchObject({
      externalId: 'UCfixture000000000000001',
      displayName: 'Example Grow Channel (fixture)',
    });
    expect(observation.accountMetrics).toEqual([
      expect.objectContaining({ metricKey: 'followers', value: 21300, availability: 'available' }),
      expect.objectContaining({ metricKey: 'posts_total', value: 240 }),
      expect.objectContaining({ metricKey: 'views', value: 1234567, period: 'lifetime' }),
    ]);
    // The upcoming premiere has no numbers yet and is left out.
    expect(observation.firstPage.posts.map((post) => post.externalId)).toEqual([
      'vidFixture01',
      'vidFixture02',
    ]);
    expect(observation.firstPage.posts[0]).toMatchObject({
      permalink: 'https://www.youtube.com/watch?v=vidFixture01',
      mediaFormat: 'video',
    });
    expect(observation.firstPage.nextCursor).toBe('CDIQAA');
    expect(collector.unitsUsed).toBe(3);
  });

  it('reports hidden likes, disabled comments and hidden subscribers, never zero', async () => {
    const yt = fakeYouTube((url) =>
      url.pathname.endsWith('/channels')
        ? { status: 200, body: fixture('channel-hidden') }
        : standard(url),
    );
    const observation = await new YouTubePublicCollector(yt.http).observeProfile(
      ctx,
      'hiddensubs',
      '2026-10-07',
    );
    expect(observation.accountMetrics[0]).toMatchObject({
      metricKey: 'followers',
      value: null,
      availability: 'hidden_by_owner',
    });
    const second = observation.firstPage.metrics.filter(
      (metric) => metric.postExternalId === 'vidFixture02',
    );
    expect(second).toEqual([
      expect.objectContaining({ metricKey: 'views', value: 800, availability: 'available' }),
      expect.objectContaining({ metricKey: 'likes', value: null, availability: 'hidden_by_owner' }),
      expect.objectContaining({
        metricKey: 'comments',
        value: null,
        availability: 'hidden_by_owner',
      }),
    ]);
  });

  it('continues from the page token and reuses the uploads playlist', async () => {
    const yt = fakeYouTube(standard);
    const collector = new YouTubePublicCollector(yt.http);
    await collector.observeProfile(ctx, 'examplegrow', '2026-10-07');
    await collector.listPosts(ctx, 'examplegrow', 'CDIQAA');
    const pages = yt.calls.filter((call) => call.url.pathname.endsWith('/playlistItems'));
    expect(pages[1]!.url.searchParams.get('pageToken')).toBe('CDIQAA');
    expect(yt.calls.filter((call) => call.url.pathname.endsWith('/channels'))).toHaveLength(1);
  });

  it('says when a channel does not exist', async () => {
    const yt = fakeYouTube(() => ({ status: 200, body: { items: [] } }));
    await expect(
      new YouTubePublicCollector(yt.http).lookupProfile(ctx, 'nobody_here'),
    ).rejects.toBeInstanceOf(ChannelNotFoundError);
  });

  it('turns quota and key errors into typed errors', async () => {
    const quota = fakeYouTube(() => ({ status: 403, body: fixture('error-quota') }));
    await expect(
      new YouTubePublicCollector(quota.http).lookupProfile(ctx, 'examplegrow'),
    ).rejects.toBeInstanceOf(RateLimitError);
    const key = fakeYouTube(() => ({ status: 400, body: fixture('error-key') }));
    await expect(
      new YouTubePublicCollector(key.http).lookupProfile(ctx, 'examplegrow'),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('needs an API key', async () => {
    const yt = fakeYouTube(standard);
    await expect(
      new YouTubePublicCollector(yt.http).lookupProfile({ viewerId: null, credential: '' }, 'x_y'),
    ).rejects.toMatchObject({ code: 'no_api_key' });
    expect(yt.calls).toHaveLength(0);
  });
});

describe('YouTube in the rest of Scopie', () => {
  it('uses a server key, not a viewer account', () => {
    expect(needsViewer('youtube')).toBe(false);
    expect(needsViewer('instagram')).toBe(true);
    expect(createPublicCollector('youtube')).toBeInstanceOf(YouTubePublicCollector);
  });

  it('keeps rounded subscriber counts and public views in their own comparability classes', () => {
    expect(
      comparabilityClass('youtube', 'account', 'followers', 'statistics.subscriberCount'),
    ).toBe('yt_subscribers_rounded');
    expect(comparabilityClass('youtube', 'post', 'views', 'statistics.viewCount')).toBe(
      'yt_public_views',
    );
  });

  it('redacts Google API keys from error text', () => {
    expect(redactText(`failed with ${KEY}`)).not.toContain(KEY);
  });

  it('reads YouTube handles and channel links in bulk lists', () => {
    expect(
      parseHandleList('@examplegrow,NL\nhttps://www.youtube.com/@other-channel', 'youtube'),
    ).toEqual({
      handles: [
        { handle: 'examplegrow', countryCode: 'NL' },
        { handle: 'other-channel', countryCode: null },
      ],
      invalid: [],
    });
  });
});
