import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AuthError, RateLimitError } from '@/lib/platforms/errors';
import type { FetchLike } from '@/lib/platforms/http';
import { FacebookAdapter, facebookMediaFormat } from '@/lib/platforms/meta/facebook';
import {
  InstagramAdapter,
  instagramMediaFormat,
  postMetricsFor,
} from '@/lib/platforms/meta/instagram';
import { META_SCOPES, MetaOAuth, metaAuthorizationUrl } from '@/lib/platforms/meta/oauth';
import { metaReportDate, unixDay } from '@/lib/platforms/meta/shared';
import { createAdapter, hasConnector } from '@/lib/platforms/registry';
import type {
  AccountContext,
  NormalizedAccountMetric,
  NormalizedPostMetric,
} from '@/lib/platforms/types';

const FIXTURES = fileURLToPath(new URL('../fixtures/meta/', import.meta.url));

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${FIXTURES}${name}.json`, 'utf8')) as Record<string, unknown>;
}

type Call = { path: string; params: URLSearchParams };
type Reply = { status: number; body: unknown; headers?: Record<string, string> };
type Route = (call: Call) => Reply | undefined;

/** A fetch that routes by Graph path (version stripped) and records every call. */
function fakeGraph(route: Route) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input) => {
    const url = new URL(input);
    const call = { path: url.pathname.replace(/^\/v\d+\.\d+/, ''), params: url.searchParams };
    calls.push(call);
    const reply = route(call);
    if (!reply) throw new Error(`Unrouted fake Graph call: ${call.path}?${call.params}`);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json', ...reply.headers },
    });
  };
  return { fetch, calls, http: { fetch, sleep: () => Promise.resolve() } };
}

const ok = (body: unknown): Reply => ({ status: 200, body });
const permissionDenied = (): Reply => ({ status: 403, body: fixture('graph-error-permission') });
const authFailed = (): Reply => ({ status: 400, body: fixture('graph-error-auth') });

/** Keeps only the requested metrics from an insights fixture, as Meta does. */
function insightsFor(name: string, metrics: string[]) {
  const body = fixture(name) as { data: { name: string }[] };
  return { data: body.data.filter((entry) => metrics.includes(entry.name)) };
}

/** Every value is a real number marked available, or null with a reason. Never a made-up zero. */
function expectHonestValues(metrics: (NormalizedPostMetric | NormalizedAccountMetric)[]) {
  expect(metrics.length).toBeGreaterThan(0);
  for (const metric of metrics) {
    if (metric.availability === 'available') {
      expect(typeof metric.value, metric.sourceMetric).toBe('number');
      expect(Number.isFinite(metric.value), metric.sourceMetric).toBe(true);
    } else {
      expect(metric.value, `${metric.sourceMetric} (${metric.availability})`).toBeNull();
    }
  }
}

function bySource<T extends { sourceMetric: string }>(metrics: T[]) {
  return Object.fromEntries(metrics.map((metric) => [metric.sourceMetric, metric]));
}

const IG_ID = '17840000000000001';
const FB_PAGE_ID = '100000000000001';
const PAGE_TOKEN = 'EAAFixturePageTokenOne000000000000';

const igCtx: AccountContext = {
  platformKey: 'instagram',
  externalId: IG_ID,
  accessToken: PAGE_TOKEN,
  accountType: 'business',
};
const fbCtx: AccountContext = {
  platformKey: 'facebook',
  externalId: FB_PAGE_ID,
  accessToken: PAGE_TOKEN,
  accountType: 'page',
};

describe('registry', () => {
  it('creates adapters for connected platforms only', () => {
    expect(createAdapter('instagram')).toBeInstanceOf(InstagramAdapter);
    expect(createAdapter('facebook')).toBeInstanceOf(FacebookAdapter);
    expect(createAdapter('linkedin')).toBeNull();
    expect(hasConnector('instagram')).toBe(true);
    expect(hasConnector('tiktok')).toBe(false);
  });
});

describe('metaReportDate', () => {
  it('maps Meta end_time (end of the Pacific day) to the reported day', () => {
    // PDT: midnight Pacific is 07:00 UTC.
    expect(metaReportDate('2026-10-02T07:00:00+0000')).toBe('2026-10-01');
    // PST: midnight Pacific is 08:00 UTC.
    expect(metaReportDate('2026-12-02T08:00:00+0000')).toBe('2026-12-01');
  });

  it('rejects an unparseable end_time', () => {
    expect(() => metaReportDate('yesterday')).toThrow(/Invalid end_time/);
  });
});

describe('InstagramAdapter.listPosts', () => {
  const graph = () =>
    fakeGraph(({ path, params }) => {
      if (path !== `/${IG_ID}/media`) return undefined;
      return ok(
        fixture(
          params.get('after') === 'QVFIUmZAfixtureafter1' ? 'ig-media-page-2' : 'ig-media-page-1',
        ),
      );
    });

  it('maps media and returns the next cursor while Meta has more pages', async () => {
    const { http, calls } = graph();
    const page = await new InstagramAdapter(http).listPosts(igCtx, null);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.params.has('after')).toBe(false);
    expect(calls[0]!.params.get('access_token')).toBe(PAGE_TOKEN);
    expect(calls[0]!.params.get('limit')).toBe('50');
    expect(calls[0]!.params.get('fields')).toContain('media_product_type');
    expect(page.nextCursor).toBe('QVFIUmZAfixtureafter1');

    expect(page.posts.map((post) => [post.externalId, post.mediaFormat, post.nativeType])).toEqual([
      ['17900000000000001', 'image', 'FEED/IMAGE'],
      ['17900000000000002', 'carousel', 'FEED/CAROUSEL_ALBUM'],
      ['17900000000000003', 'short_video', 'REELS/VIDEO'],
    ]);
    const [photo, carousel] = page.posts;
    expect(photo).toMatchObject({
      publishedAt: '2026-10-03T09:30:00.000Z',
      permalink: 'https://www.instagram.com/p/FIXTURE001/',
      caption: 'Fixture photo post',
      media: [],
    });
    expect(carousel!.media).toEqual([
      { position: 0, mediaType: 'IMAGE', externalId: '17900000000000101', durationSeconds: null },
      { position: 1, mediaType: 'VIDEO', externalId: '17900000000000102', durationSeconds: null },
    ]);
  });

  it('passes the cursor and stops when there is no next page', async () => {
    const { http, calls } = graph();
    const page = await new InstagramAdapter(http).listPosts(igCtx, 'QVFIUmZAfixtureafter1');
    expect(calls[0]!.params.get('after')).toBe('QVFIUmZAfixtureafter1');
    expect(page.nextCursor).toBeNull();
    expect(page.posts).toHaveLength(1);
    expect(page.posts[0]).toMatchObject({
      externalId: '17900000000000004',
      mediaFormat: 'video',
      caption: null,
    });
  });

  it('keeps raw responses for debugging until drained', async () => {
    const { http } = graph();
    const adapter = new InstagramAdapter(http);
    await adapter.listPosts(igCtx, null);
    const raw = adapter.drainRawPayloads();
    expect(raw).toEqual([{ endpoint: `GET ${IG_ID}/media`, payload: fixture('ig-media-page-1') }]);
    expect(adapter.drainRawPayloads()).toEqual([]);
  });
});

describe('instagramMediaFormat', () => {
  it.each([
    ['IMAGE', 'FEED', 'image'],
    ['CAROUSEL_ALBUM', 'FEED', 'carousel'],
    ['VIDEO', 'FEED', 'video'],
    ['VIDEO', 'REELS', 'short_video'],
    ['VIDEO', 'STORY', 'story'],
    ['IMAGE', 'STORY', 'story'],
    ['IMAGE', undefined, 'image'],
    ['SOMETHING_NEW', 'FEED', 'other'],
  ] as const)('%s / %s → %s', (mediaType, productType, format) => {
    expect(instagramMediaFormat(mediaType, productType)).toBe(format);
  });
});

describe('InstagramAdapter.getPostMetrics', () => {
  it('asks for metrics by format', () => {
    expect(postMetricsFor('image')).not.toContain('ig_reels_avg_watch_time');
    expect(postMetricsFor('short_video')).toEqual(
      expect.arrayContaining([
        'ig_reels_video_view_total_time',
        'ig_reels_avg_watch_time',
        'saved',
      ]),
    );
    expect(postMetricsFor('story')).toEqual(['reach', 'views', 'shares', 'total_interactions']);
  });

  it('requests the right metrics per format and converts reel watch time from ms to seconds', async () => {
    const { http, calls } = fakeGraph(({ path, params }) => {
      const metrics = params.get('metric')!.split(',');
      if (path === '/17900000000000001/insights')
        return ok(insightsFor('ig-media-insights-feed', metrics));
      if (path === '/17900000000000003/insights')
        return ok(insightsFor('ig-media-insights-reel', metrics));
      if (path === '/17900000000000005/insights')
        return ok(insightsFor('ig-media-insights-story', metrics));
      return undefined;
    });
    const result = await new InstagramAdapter(http).getPostMetrics(igCtx, [
      { externalId: '17900000000000001', mediaFormat: 'image', nativeType: 'FEED/IMAGE' },
      { externalId: '17900000000000003', mediaFormat: 'short_video', nativeType: 'REELS/VIDEO' },
      { externalId: '17900000000000005', mediaFormat: 'story', nativeType: 'STORY/IMAGE' },
    ]);

    expect(result.failures).toEqual([]);
    expect(calls.map((call) => call.params.get('metric'))).toEqual([
      postMetricsFor('image').join(','),
      postMetricsFor('short_video').join(','),
      postMetricsFor('story').join(','),
    ]);
    expectHonestValues(result.metrics);

    const image = bySource(result.metrics.filter((m) => m.postExternalId === '17900000000000001'));
    expect(Object.keys(image).sort()).toEqual([...postMetricsFor('image')].sort());
    expect(image.saved).toMatchObject({ metricKey: 'saves', value: 21, availability: 'available' });
    // A real zero from Meta stays a zero.
    expect(image.comments).toMatchObject({ value: 0, availability: 'available' });

    const reel = bySource(result.metrics.filter((m) => m.postExternalId === '17900000000000003'));
    expect(reel.ig_reels_video_view_total_time).toMatchObject({
      metricKey: 'watch_time',
      value: 45678,
      availability: 'available',
    });
    expect(reel.ig_reels_avg_watch_time).toMatchObject({
      metricKey: 'avg_watch_duration',
      value: 6.25,
    });
    expect(reel.views!.value).toBe(12040); // counts are not transformed

    const story = result.metrics.filter((m) => m.postExternalId === '17900000000000005');
    expect(story.map((m) => m.sourceMetric)).toEqual([
      'reach',
      'views',
      'shares',
      'total_interactions',
    ]);

    for (const metric of result.metrics) {
      expect(metric.period).toBe('lifetime');
      expect(metric.metricDate).toBeNull();
    }
  });

  it('isolates a metric the connection may not read and still returns the others', async () => {
    const { http, calls } = fakeGraph(({ path, params }) => {
      if (path !== '/17900000000000001/insights') return undefined;
      const metrics = params.get('metric')!.split(',');
      if (metrics.includes('saved')) return permissionDenied();
      return ok(insightsFor('ig-media-insights-feed', metrics));
    });
    const result = await new InstagramAdapter(http).getPostMetrics(igCtx, [
      { externalId: '17900000000000001', mediaFormat: 'image', nativeType: 'FEED/IMAGE' },
    ]);

    // One combined request, then one per metric.
    expect(calls).toHaveLength(1 + postMetricsFor('image').length);
    expect(result.failures).toEqual([]);
    expectHonestValues(result.metrics);
    const metrics = bySource(result.metrics);
    expect(metrics.saved).toMatchObject({ value: null, availability: 'not_permitted' });
    for (const name of ['reach', 'views', 'likes', 'comments', 'shares', 'total_interactions']) {
      expect(metrics[name]!.availability, name).toBe('available');
    }
    expect(metrics.reach!.value).toBe(1520);
  });

  it('marks a metric Meta rejects as an invalid parameter as error, not zero', async () => {
    const { http } = fakeGraph(({ params }) => {
      const metrics = params.get('metric')!.split(',');
      if (metrics.includes('views'))
        return {
          status: 400,
          body: {
            error: { message: '(#100) Incompatible metric', type: 'OAuthException', code: 100 },
          },
        };
      return ok(insightsFor('ig-media-insights-story', metrics));
    });
    const result = await new InstagramAdapter(http).getPostMetrics(igCtx, [
      { externalId: '17900000000000005', mediaFormat: 'story', nativeType: 'STORY/IMAGE' },
    ]);
    expectHonestValues(result.metrics);
    expect(bySource(result.metrics).views).toMatchObject({ value: null, availability: 'error' });
    expect(bySource(result.metrics).reach).toMatchObject({ value: 410, availability: 'available' });
  });

  it('marks a metric Meta silently leaves out as error with no value', async () => {
    const { http } = fakeGraph(({ params }) =>
      ok(
        insightsFor(
          'ig-media-insights-feed',
          params
            .get('metric')!
            .split(',')
            .filter((name) => name !== 'likes'),
        ),
      ),
    );
    const result = await new InstagramAdapter(http).getPostMetrics(igCtx, [
      { externalId: '17900000000000001', mediaFormat: 'image', nativeType: 'FEED/IMAGE' },
    ]);
    expectHonestValues(result.metrics);
    expect(bySource(result.metrics).likes).toMatchObject({ value: null, availability: 'error' });
  });

  it('lets an auth error stop the job instead of recording it per post', async () => {
    const { http, calls } = fakeGraph(() => authFailed());
    await expect(
      new InstagramAdapter(http).getPostMetrics(igCtx, [
        { externalId: '17900000000000001', mediaFormat: 'image', nativeType: 'FEED/IMAGE' },
        { externalId: '17900000000000003', mediaFormat: 'short_video', nativeType: 'REELS/VIDEO' },
      ]),
    ).rejects.toBeInstanceOf(AuthError);
    expect(calls).toHaveLength(1);
  });

  it('lets an auth error during the per-metric fallback stop the job', async () => {
    const { http } = fakeGraph(({ params }) =>
      params.get('metric')!.includes(',') ? permissionDenied() : authFailed(),
    );
    await expect(
      new InstagramAdapter(http).getPostMetrics(igCtx, [
        { externalId: '17900000000000001', mediaFormat: 'image', nativeType: 'FEED/IMAGE' },
      ]),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('lets a rate limit stop the job', async () => {
    const { http } = fakeGraph(() => ({
      status: 400,
      body: { error: { message: '(#4) Application request limit reached', code: 4 } },
    }));
    await expect(
      new InstagramAdapter(http).getPostMetrics(igCtx, [
        { externalId: '17900000000000001', mediaFormat: 'image', nativeType: 'FEED/IMAGE' },
      ]),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('records other errors against the post and carries on', async () => {
    const { http } = fakeGraph(({ path, params }) => {
      if (path === '/17900000000000001/insights')
        return { status: 400, body: { error: { message: 'An unknown error occurred', code: 1 } } };
      return ok(insightsFor('ig-media-insights-feed', params.get('metric')!.split(',')));
    });
    const result = await new InstagramAdapter(http).getPostMetrics(igCtx, [
      { externalId: '17900000000000001', mediaFormat: 'image', nativeType: 'FEED/IMAGE' },
      {
        externalId: '17900000000000002',
        mediaFormat: 'carousel',
        nativeType: 'FEED/CAROUSEL_ALBUM',
      },
    ]);
    expect(result.failures).toEqual([
      { postExternalId: '17900000000000001', message: 'An unknown error occurred' },
    ]);
    expect(new Set(result.metrics.map((m) => m.postExternalId))).toEqual(
      new Set(['17900000000000002']),
    );
  });
});

describe('InstagramAdapter.getAccountMetrics', () => {
  // The sync engine asks for complete days only: until = yesterday, asOf = today.
  const range = { since: '2026-10-01', until: '2026-10-03', asOf: '2026-10-04' };

  function accountGraph(overrides: Partial<Record<'profile' | 'follower_count', Reply>> = {}) {
    return fakeGraph(({ path, params }) => {
      if (path === `/${IG_ID}`) return overrides.profile ?? ok(fixture('ig-profile'));
      if (path !== `/${IG_ID}/insights`) return undefined;
      if (params.get('metric') === 'follower_count')
        return overrides.follower_count ?? ok(fixture('ig-follower-count-daily'));
      if (params.get('metric_type') === 'total_value') {
        const metrics = params.get('metric')!.split(',');
        // profile_views is not permitted on 2026-10-02 only.
        if (
          params.get('since') === String(unixDay('2026-10-02')) &&
          metrics.includes('profile_views')
        )
          return permissionDenied();
        return ok(insightsFor('ig-account-total-value', metrics));
      }
      return undefined;
    });
  }

  it('stores followers_count as a lifetime value dated asOf', async () => {
    const { http } = accountGraph();
    const metrics = await new InstagramAdapter(http).getAccountMetrics(igCtx, range);
    const followers = metrics.filter((m) => m.sourceMetric === 'followers_count');
    expect(followers).toEqual([
      {
        metricKey: 'followers',
        sourceMetric: 'followers_count',
        value: 4821,
        availability: 'available',
        period: 'lifetime',
        metricDate: '2026-10-04',
      },
    ]);
  });

  it('maps daily follower gains by report date and marks missing days pending', async () => {
    const { http, calls } = accountGraph();
    const metrics = await new InstagramAdapter(http).getAccountMetrics(igCtx, range);

    const request = calls.find((call) => call.params.get('metric') === 'follower_count')!;
    expect(request.params.get('period')).toBe('day');
    expect(request.params.get('since')).toBe(String(unixDay('2026-10-01')));
    expect(request.params.get('until')).toBe(String(unixDay('2026-10-04')));

    const gained = metrics.filter((m) => m.sourceMetric === 'follower_count');
    expect(gained.map((m) => [m.metricDate, m.value, m.availability])).toEqual([
      ['2026-10-01', 12, 'available'], // end_time 2026-10-02T07:00 → 2026-10-01
      ['2026-10-02', 0, 'available'],
      ['2026-10-03', null, 'pending'], // Meta has not reported this day yet
    ]);
    for (const metric of gained) {
      expect(metric.metricKey).toBe('followers_gained');
      expect(metric.period).toBe('day');
    }
  });

  it('never stores a daily value for asOf (today, still partial) or later', async () => {
    const { http } = accountGraph();
    const metrics = await new InstagramAdapter(http).getAccountMetrics(igCtx, range);
    const daily = metrics.filter((m) => m.period === 'day');
    expect(daily.length).toBeGreaterThan(0);
    for (const metric of daily) {
      expect(metric.metricDate >= range.since && metric.metricDate <= range.until).toBe(true);
    }
    // The fixture includes a value for 2026-10-04 (end_time 2026-10-05); it is dropped.
    expect(metrics.some((m) => m.period === 'day' && m.metricDate === range.asOf)).toBe(false);
    expect(metrics.filter((m) => m.metricDate === range.asOf).map((m) => m.sourceMetric)).toEqual([
      'followers_count',
    ]);
  });

  it('asks for daily totals one day at a time and isolates a forbidden metric', async () => {
    const { http, calls } = accountGraph();
    const metrics = await new InstagramAdapter(http).getAccountMetrics(igCtx, range);
    expectHonestValues(metrics);

    const totalCalls = calls.filter(
      (call) =>
        call.params.get('metric_type') === 'total_value' &&
        call.params.get('metric')!.includes(','),
    );
    expect(totalCalls.map((call) => [call.params.get('since'), call.params.get('until')])).toEqual([
      [String(unixDay('2026-10-01')), String(unixDay('2026-10-02'))],
      [String(unixDay('2026-10-02')), String(unixDay('2026-10-03'))],
      [String(unixDay('2026-10-03')), String(unixDay('2026-10-04'))],
    ]);

    const profileViews = metrics.filter((m) => m.sourceMetric === 'profile_views');
    expect(profileViews.map((m) => [m.metricDate, m.value, m.availability])).toEqual([
      ['2026-10-01', 87, 'available'],
      ['2026-10-02', null, 'not_permitted'],
      ['2026-10-03', 87, 'available'],
    ]);
    const reach = metrics.filter((m) => m.sourceMetric === 'reach');
    expect(reach.map((m) => [m.metricDate, m.metricKey, m.value])).toEqual([
      ['2026-10-01', 'reach', 3100],
      ['2026-10-02', 'reach', 3100],
      ['2026-10-03', 'reach', 3100],
    ]);
  });

  it('reports a missing followers_count as an error, not zero', async () => {
    const { http } = accountGraph({ profile: ok({ id: IG_ID }) });
    const metrics = await new InstagramAdapter(http).getAccountMetrics(igCtx, range);
    expect(metrics.find((m) => m.sourceMetric === 'followers_count')).toMatchObject({
      value: null,
      availability: 'error',
      metricDate: '2026-10-04',
    });
  });

  it('marks every day not_permitted when daily follower gains are forbidden', async () => {
    const { http } = accountGraph({ follower_count: permissionDenied() });
    const metrics = await new InstagramAdapter(http).getAccountMetrics(igCtx, range);
    const gained = metrics.filter((m) => m.sourceMetric === 'follower_count');
    expect(gained).toHaveLength(3);
    for (const metric of gained)
      expect(metric).toMatchObject({ value: null, availability: 'not_permitted' });
  });

  it('lets an auth error on account insights stop the job', async () => {
    const { http } = accountGraph({ follower_count: authFailed() });
    await expect(new InstagramAdapter(http).getAccountMetrics(igCtx, range)).rejects.toBeInstanceOf(
      AuthError,
    );
  });
});

describe('FacebookAdapter.listPosts', () => {
  it('lists published posts and maps attachment types to media formats', async () => {
    const { http, calls } = fakeGraph(({ path }) =>
      path === `/${FB_PAGE_ID}/published_posts` ? ok(fixture('fb-published-posts')) : undefined,
    );
    const page = await new FacebookAdapter(http).listPosts(fbCtx, 'QVFIUfixturefbprev');

    expect(calls[0]!.params.get('after')).toBe('QVFIUfixturefbprev');
    expect(calls[0]!.params.get('fields')).toContain('attachments{media_type,type,subattachments}');
    expect(page.nextCursor).toBe('QVFIUfixturefbafter');
    expect(page.posts.map((post) => [post.externalId, post.mediaFormat, post.nativeType])).toEqual([
      ['100000000000001_200000000000001', 'image', 'added_photos'],
      ['100000000000001_200000000000002', 'carousel', 'added_photos'],
      ['100000000000001_200000000000003', 'video', 'added_video'],
      ['100000000000001_200000000000004', 'link', 'shared_story'],
      ['100000000000001_200000000000005', 'text', 'mobile_status_update'],
    ]);
    expect(page.posts[0]).toMatchObject({
      publishedAt: '2026-10-03T10:00:00.000Z',
      permalink: 'https://www.facebook.com/100000000000001/posts/200000000000001',
      caption: 'Fixture photo on the page',
    });
  });

  it('maps edge cases of attachments', () => {
    const base = { id: '1', created_time: '2026-10-01T00:00:00+0000' };
    expect(
      facebookMediaFormat({ ...base, attachments: { data: [{ type: 'video_autoplay' }] } }),
    ).toBe('video');
    expect(
      facebookMediaFormat({
        ...base,
        attachments: {
          data: [{ type: 'photo', subattachments: { data: [{ media_type: 'photo' }, {}] } }],
        },
      }),
    ).toBe('carousel');
    expect(facebookMediaFormat({ ...base, attachments: { data: [{ type: 'event' }] } })).toBe(
      'other',
    );
  });
});

describe('FacebookAdapter.getPostMetrics', () => {
  const posts = [
    {
      externalId: '100000000000001_200000000000001',
      mediaFormat: 'image',
      nativeType: 'added_photos',
    },
    {
      externalId: '100000000000001_200000000000005',
      mediaFormat: 'text',
      nativeType: 'mobile_status_update',
    },
  ] as const;

  function postGraph() {
    return fakeGraph(({ path }) => {
      if (path === `/${posts[0].externalId}`) return ok(fixture('fb-post-metrics-with-shares'));
      if (path === `/${posts[1].externalId}`) return ok(fixture('fb-post-metrics-no-shares'));
      return undefined;
    });
  }

  it('reads reaction and comment summaries, shares and insights', async () => {
    const { http, calls } = postGraph();
    const result = await new FacebookAdapter(http).getPostMetrics(fbCtx, [...posts]);
    expect(calls[0]!.params.get('fields')).toBe(
      'reactions.summary(true).limit(0),comments.summary(true).limit(0),shares,insights.metric(post_impressions_unique,post_impressions,post_clicks)',
    );
    expect(result.failures).toEqual([]);
    expectHonestValues(result.metrics);

    const first = bySource(result.metrics.filter((m) => m.postExternalId === posts[0].externalId));
    expect(
      Object.fromEntries(Object.values(first).map((m) => [m.metricKey, [m.value, m.availability]])),
    ).toEqual({
      reactions: [57, 'available'],
      comments: [6, 'available'],
      shares: [4, 'available'],
      reach: [980, 'available'],
      impressions: [1430, 'available'],
      link_clicks: [31, 'available'],
    });
  });

  it('treats absent shares as zero (documented Facebook convention) but nothing else', async () => {
    const { http } = postGraph();
    const result = await new FacebookAdapter(http).getPostMetrics(fbCtx, [...posts]);
    const second = bySource(result.metrics.filter((m) => m.postExternalId === posts[1].externalId));
    expect(second['shares.count']).toMatchObject({ value: 0, availability: 'available' });
    expect(second['reactions.summary.total_count']).toMatchObject({
      value: 0,
      availability: 'available',
    });
    expect(second['comments.summary.total_count']!.value).toBe(2);
    // post_clicks is missing from the response: unknown, not zero.
    expect(second.post_clicks).toMatchObject({ value: null, availability: 'error' });
  });

  it('reports a post without reaction or comment summaries as error, not zero', async () => {
    const { http } = fakeGraph(() => ok({ id: posts[0].externalId }));
    const result = await new FacebookAdapter(http).getPostMetrics(fbCtx, [posts[0]]);
    const metrics = bySource(result.metrics);
    expect(metrics['reactions.summary.total_count']).toMatchObject({
      value: null,
      availability: 'error',
    });
    expect(metrics['comments.summary.total_count']).toMatchObject({
      value: null,
      availability: 'error',
    });
    expect(metrics.post_impressions).toMatchObject({ value: null, availability: 'error' });
  });

  it('records a per-post permission error and carries on, but lets auth errors stop the job', async () => {
    const { http } = fakeGraph(({ path }) =>
      path === `/${posts[0].externalId}`
        ? permissionDenied()
        : ok(fixture('fb-post-metrics-no-shares')),
    );
    const result = await new FacebookAdapter(http).getPostMetrics(fbCtx, [...posts]);
    expect(result.failures.map((f) => f.postExternalId)).toEqual([posts[0].externalId]);
    expect(result.metrics.every((m) => m.postExternalId === posts[1].externalId)).toBe(true);

    const auth = fakeGraph(() => authFailed());
    await expect(
      new FacebookAdapter(auth.http).getPostMetrics(fbCtx, [...posts]),
    ).rejects.toBeInstanceOf(AuthError);
    expect(auth.calls).toHaveLength(1);
  });
});

describe('FacebookAdapter.getAccountMetrics', () => {
  it('maps page insights by report date, marks gaps pending and forbidden metrics not_permitted', async () => {
    const range = { since: '2026-10-01', until: '2026-10-03', asOf: '2026-10-04' };
    const { http } = fakeGraph(({ path, params }) => {
      if (path === `/${FB_PAGE_ID}`) return ok(fixture('fb-page'));
      if (path !== `/${FB_PAGE_ID}/insights`) return undefined;
      if (params.get('metric') === 'page_impressions_unique')
        return ok(fixture('fb-page-insights-reach'));
      if (params.get('metric') === 'page_post_engagements') return permissionDenied();
      return undefined;
    });
    const metrics = await new FacebookAdapter(http).getAccountMetrics(fbCtx, range);
    expectHonestValues(metrics);

    expect(metrics[0]).toEqual({
      metricKey: 'followers',
      sourceMetric: 'followers_count',
      value: 2210,
      availability: 'available',
      period: 'lifetime',
      metricDate: '2026-10-04',
    });
    const reach = metrics.filter((m) => m.sourceMetric === 'page_impressions_unique');
    expect(reach.map((m) => [m.metricDate, m.value, m.availability])).toEqual([
      ['2026-10-01', 640, 'available'],
      ['2026-10-02', null, 'pending'],
      ['2026-10-03', 0, 'available'],
    ]);
    const engagements = metrics.filter((m) => m.sourceMetric === 'page_post_engagements');
    expect(engagements.map((m) => [m.metricDate, m.value, m.availability])).toEqual([
      ['2026-10-01', null, 'not_permitted'],
      ['2026-10-02', null, 'not_permitted'],
      ['2026-10-03', null, 'not_permitted'],
    ]);
  });
});

describe('MetaOAuth', () => {
  const config = { appId: '1000000000000001', appSecret: 'fixture-app-secret', version: 'v24.0' };
  const USER_TOKEN = 'EAAFixtureUserToken0000000000000000';

  it('builds the authorization URL with the read-only scopes', () => {
    const url = new URL(
      metaAuthorizationUrl({
        config,
        redirectUri: 'https://scopie.test/api/connections/meta/callback',
        state: 'fixture-state',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v24.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('1000000000000001');
    expect(url.searchParams.get('state')).toBe('fixture-state');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')!.split(',')).toEqual(META_SCOPES.map((s) => s.scope));
    expect(url.searchParams.has('client_secret')).toBe(false);
  });

  it('exchanges a code for a token with an expiry from now', async () => {
    const { http, calls } = fakeGraph(() =>
      ok({ access_token: USER_TOKEN, token_type: 'bearer', expires_in: 3600 }),
    );
    const oauth = new MetaOAuth(config, http, () => new Date('2026-10-07T12:00:00Z'));
    const token = await oauth.exchangeCode('fixture-code', 'https://scopie.test/callback');
    expect(token).toEqual({
      accessToken: USER_TOKEN,
      expiresAt: new Date('2026-10-07T13:00:00Z'),
    });
    expect(calls[0]!.path).toBe('/oauth/access_token');
    expect(calls[0]!.params.get('code')).toBe('fixture-code');
  });

  it('discovers Pages and their linked Instagram accounts across pages of results', async () => {
    const { http, calls } = fakeGraph(({ path, params }) => {
      if (path !== '/me/accounts') return undefined;
      return ok(
        fixture(
          params.get('after') === 'QVFIUfixtureacctafter'
            ? 'me-accounts-page-2'
            : 'me-accounts-page-1',
        ),
      );
    });
    const assets = await new MetaOAuth(config, http).discoverAssets(USER_TOKEN);

    expect(calls).toHaveLength(2);
    expect(calls[0]!.params.get('access_token')).toBe(USER_TOKEN);
    expect(calls[0]!.params.get('appsecret_proof')).toMatch(/^[0-9a-f]{64}$/);
    expect(calls[0]!.params.get('fields')).toContain('instagram_business_account');
    expect(assets).toEqual([
      {
        platformKey: 'facebook',
        externalId: '100000000000001',
        name: 'Fixture Bakery',
        handle: null,
        accountType: 'page',
        parentExternalId: null,
        accessToken: 'EAAFixturePageTokenOne000000000000',
      },
      {
        platformKey: 'instagram',
        externalId: '17840000000000001',
        name: 'Fixture Account',
        handle: 'fixture_account',
        accountType: 'business',
        parentExternalId: '100000000000001',
        accessToken: 'EAAFixturePageTokenOne000000000000',
      },
      {
        platformKey: 'facebook',
        externalId: '100000000000002',
        name: 'Fixture Page Without Instagram',
        handle: null,
        accountType: 'page',
        parentExternalId: null,
        accessToken: 'EAAFixturePageTokenTwo000000000000',
      },
      {
        platformKey: 'facebook',
        externalId: '100000000000003',
        name: 'Fixture Studio',
        handle: null,
        accountType: 'page',
        parentExternalId: null,
        accessToken: 'EAAFixturePageTokenThree0000000000',
      },
      {
        platformKey: 'instagram',
        externalId: '17840000000000003',
        name: 'fixture_studio', // no display name: falls back to the username
        handle: 'fixture_studio',
        accountType: 'business',
        parentExternalId: '100000000000003',
        accessToken: 'EAAFixturePageTokenThree0000000000',
      },
    ]);
  });
});
