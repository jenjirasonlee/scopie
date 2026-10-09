import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AuthError, PlatformError, RateLimitError } from '@/lib/platforms/errors';
import type { FetchLike } from '@/lib/platforms/http';
import {
  INSTAGRAM_USERNAME,
  InstagramPublicCollector,
  PAGE_SIZE,
  ProfileNotFoundError,
  normalizeHandle,
} from '@/lib/platforms/meta/business-discovery';
import { appUsagePercent } from '@/lib/platforms/meta/graph';
import { createPublicCollector, hasPublicCollector } from '@/lib/platforms/registry';
import type { PublicContext } from '@/lib/platforms/types';

const FIXTURES = fileURLToPath(new URL('../fixtures/meta/', import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(`${FIXTURES}${name}.json`, 'utf8')) as Record<string, unknown>;

type Reply = { status: number; body: unknown; headers?: Record<string, string> };

function fakeGraph(route: (fields: string) => Reply) {
  const calls: URL[] = [];
  const fetch: FetchLike = async (input) => {
    const url = new URL(input);
    calls.push(url);
    const reply = route(url.searchParams.get('fields') ?? '');
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json', ...reply.headers },
    });
  };
  return { calls, http: { fetch, sleep: () => Promise.resolve() } };
}

const ctx: PublicContext = { viewerId: '17841400000000999', credential: 'fixture-viewer-token' };
const invalidParameter = (message = 'Invalid parameter'): Reply => ({
  status: 400,
  body: { error: { message, type: 'OAuthException', code: 100 } },
});

describe('Instagram public collector (Business Discovery)', () => {
  it('asks the viewer account for the profile, never the profile owner', async () => {
    const graph = fakeGraph(() => ({ status: 200, body: fixture('ig-business-discovery') }));
    const collector = new InstagramPublicCollector(graph.http);
    await collector.observeProfile(ctx, '@Example_Competitor', '2026-10-07');
    const url = graph.calls[0]!;
    expect(url.pathname).toMatch(/\/17841400000000999$/);
    expect(url.searchParams.get('fields')).toMatch(
      /^business_discovery\.username\(Example_Competitor\)\{/,
    );
    expect(url.searchParams.get('access_token')).toBe('fixture-viewer-token');
  });

  it('only requests fields Meta documents as public', async () => {
    const graph = fakeGraph(() => ({ status: 200, body: fixture('ig-business-discovery') }));
    await new InstagramPublicCollector(graph.http).observeProfile(ctx, 'example', '2026-10-07');
    const fields = graph.calls[0]!.searchParams.get('fields')!;
    for (const owner of ['reach', 'saved', 'shares', 'insights', 'follows_count', 'impressions']) {
      expect(fields).not.toContain(owner);
    }
  });

  it('maps the profile, totals and posts', async () => {
    const graph = fakeGraph(() => ({ status: 200, body: fixture('ig-business-discovery') }));
    const observation = await new InstagramPublicCollector(graph.http).observeProfile(
      ctx,
      'example_competitor',
      '2026-10-07',
    );
    expect(observation.profile).toEqual({
      externalId: '17841400000000001',
      username: 'example_competitor',
      displayName: 'Example Competitor (fixture)',
      biography: 'Fixture profile for tests. Not a real account.',
      website: 'https://example.com/',
      profilePictureUrl: 'https://scontent.example.com/fixture.jpg',
    });
    expect(observation.accountMetrics).toEqual([
      expect.objectContaining({ metricKey: 'followers', value: 20400, metricDate: '2026-10-07' }),
      expect.objectContaining({ metricKey: 'posts_total', value: 812, availability: 'available' }),
    ]);
    expect(observation.firstPage.posts.map((post) => post.mediaFormat)).toEqual([
      'short_video',
      'carousel',
      'image',
    ]);
    expect(observation.firstPage.posts[0]).toMatchObject({
      publishedAt: '2026-10-05T09:00:00.000Z',
      permalink: 'https://www.instagram.com/reel/FIXTURE1/',
    });
    // Fewer posts than a full page: there is nothing more to read.
    expect(observation.firstPage.nextCursor).toBeNull();
  });

  it('never turns a missing public number into zero', async () => {
    const graph = fakeGraph(() => ({ status: 200, body: fixture('ig-business-discovery') }));
    const { firstPage } = await new InstagramPublicCollector(graph.http).observeProfile(
      ctx,
      'example_competitor',
      '2026-10-07',
    );
    const metric = (post: string, key: string) =>
      firstPage.metrics.find(
        (entry) => entry.postExternalId === `1800000000000000${post}` && entry.metricKey === key,
      );
    expect(metric('1', 'views')).toMatchObject({ value: 9100, availability: 'available' });
    // Likes hidden by the owner are left out of the response.
    expect(metric('2', 'likes')).toMatchObject({ value: null, availability: 'hidden_by_owner' });
    // Views are only public for Reels.
    expect(metric('2', 'views')).toMatchObject({ value: null, availability: 'not_applicable' });
    // A real zero stays a zero.
    expect(metric('3', 'likes')).toMatchObject({ value: 0, availability: 'available' });
    for (const entry of firstPage.metrics) {
      expect(entry.availability === 'available').toBe(entry.value !== null);
    }
  });

  it('keeps Reel views apart from insights views', async () => {
    const graph = fakeGraph(() => ({ status: 200, body: fixture('ig-business-discovery') }));
    const { firstPage } = await new InstagramPublicCollector(graph.http).observeProfile(
      ctx,
      'example_competitor',
      '2026-10-07',
    );
    const views = firstPage.metrics.find((entry) => entry.metricKey === 'views');
    expect(views!.sourceMetric).toBe('business_discovery.view_count');
  });

  it('pages with the cursor from a full page', async () => {
    const body = fixture('ig-business-discovery') as {
      business_discovery: { media: { data: unknown[] } };
    };
    const one = body.business_discovery.media.data[0];
    body.business_discovery.media.data = Array.from({ length: PAGE_SIZE }, (_, index) => ({
      ...(one as object),
      id: `1900000000000${index}`,
    }));
    const graph = fakeGraph(() => ({ status: 200, body }));
    const collector = new InstagramPublicCollector(graph.http);
    const page = await collector.listPosts(ctx, 'example_competitor', null);
    expect(page.nextCursor).toBe('QVFIUFIXTURE');
    await collector.listPosts(ctx, 'example_competitor', page.nextCursor);
    expect(graph.calls[1]!.searchParams.get('fields')).toContain('media.after(QVFIUFIXTURE)');
  });

  it('drops the optional name and picture fields if Meta refuses them', async () => {
    const full = fixture('ig-business-discovery') as { business_discovery: object };
    const graph = fakeGraph((fields) =>
      fields.includes('profile_picture_url')
        ? invalidParameter('Tried accessing nonexisting field (profile_picture_url)')
        : { status: 200, body: full },
    );
    const collector = new InstagramPublicCollector(graph.http);
    await collector.lookupProfile(ctx, 'example_competitor');
    await collector.lookupProfile(ctx, 'example_competitor');
    expect(graph.calls).toHaveLength(3); // refused, retried, then remembered
  });

  it('explains when a username is not a readable business or creator account', async () => {
    const graph = fakeGraph(() => invalidParameter());
    const lookup = new InstagramPublicCollector(graph.http).lookupProfile(ctx, 'someone_personal');
    await expect(lookup).rejects.toBeInstanceOf(ProfileNotFoundError);
    await expect(lookup).rejects.toThrow(/Personal and age-restricted/);
  });

  it('rejects invalid usernames without calling Meta', async () => {
    const graph = fakeGraph(() => ({ status: 200, body: {} }));
    await expect(
      new InstagramPublicCollector(graph.http).lookupProfile(ctx, 'not a handle!'),
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
    expect(graph.calls).toHaveLength(0);
  });

  it('needs a viewer account', async () => {
    const graph = fakeGraph(() => ({ status: 200, body: {} }));
    await expect(
      new InstagramPublicCollector(graph.http).lookupProfile(
        { viewerId: null, credential: 'x' },
        'example',
      ),
    ).rejects.toMatchObject({ code: 'no_viewer' });
  });

  it('reports token and rate-limit errors as typed errors', async () => {
    const auth = fakeGraph(() => ({ status: 400, body: fixture('graph-error-auth') }));
    await expect(
      new InstagramPublicCollector(auth.http).lookupProfile(ctx, 'example'),
    ).rejects.toBeInstanceOf(AuthError);
    const limited = fakeGraph(() => ({
      status: 400,
      body: { error: { message: 'Application request limit reached', code: 4 } },
    }));
    await expect(
      new InstagramPublicCollector(limited.http).lookupProfile(ctx, 'example'),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('tracks how much of the hourly app limit is used', async () => {
    const graph = fakeGraph(() => ({
      status: 200,
      body: fixture('ig-business-discovery'),
      headers: { 'x-app-usage': '{"call_count":82,"total_cputime":10,"total_time":12}' },
    }));
    const collector = new InstagramPublicCollector(graph.http);
    await collector.lookupProfile(ctx, 'example_competitor');
    expect(collector.appUsage).toBe(82);
  });

  it('keeps raw responses for debugging, without the token', async () => {
    const graph = fakeGraph(() => ({ status: 200, body: fixture('ig-business-discovery') }));
    const collector = new InstagramPublicCollector(graph.http);
    await collector.lookupProfile(ctx, 'example_competitor');
    const raw = collector.drainRawPayloads();
    expect(raw).toHaveLength(1);
    expect(JSON.stringify(raw)).not.toContain('fixture-viewer-token');
    expect(collector.drainRawPayloads()).toEqual([]);
  });
});

describe('usernames', () => {
  it('accepts handles, @handles and profile links', () => {
    expect(normalizeHandle(' @canna_de ')).toBe('canna_de');
    expect(normalizeHandle('https://www.instagram.com/canna.uk/?hl=en')).toBe('canna.uk');
    expect(INSTAGRAM_USERNAME.test('canna.uk')).toBe(true);
    expect(INSTAGRAM_USERNAME.test('a'.repeat(31))).toBe(false);
    expect(INSTAGRAM_USERNAME.test('bad-handle')).toBe(false);
  });
});

describe('X-App-Usage', () => {
  it('reads the highest percentage', () => {
    const headers = new Headers({
      'x-app-usage': '{"call_count":12,"total_cputime":45,"total_time":30}',
    });
    expect(appUsagePercent(headers)).toBe(45);
    expect(appUsagePercent(new Headers())).toBeNull();
    expect(appUsagePercent(new Headers({ 'x-app-usage': 'nonsense' }))).toBeNull();
  });
});

describe('public collector registry', () => {
  it('has Instagram, YouTube, X and Bluesky, until other official public APIs are built', () => {
    expect(hasPublicCollector('instagram')).toBe(true);
    expect(hasPublicCollector('youtube')).toBe(true);
    expect(hasPublicCollector('x')).toBe(true);
    expect(hasPublicCollector('bluesky')).toBe(true);
    expect(hasPublicCollector('threads')).toBe(false);
    expect(hasPublicCollector('pinterest')).toBe(false);
    expect(hasPublicCollector('linkedin')).toBe(false);
    expect(createPublicCollector('tiktok')).toBeNull();
    expect(createPublicCollector('instagram')).toBeInstanceOf(InstagramPublicCollector);
  });

  it('is a PlatformError subclass for the engine', () => {
    expect(new ProfileNotFoundError('x')).toBeInstanceOf(PlatformError);
  });
});
