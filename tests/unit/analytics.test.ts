import { describe, expect, it } from 'vitest';
import {
  checkComparable,
  comparableValue,
  compareValues,
  comparisonSource,
  postSources,
  summarizeGroups,
} from '@/lib/analytics/compare';
import { formatMix, hashtagCounts, topPosts } from '@/lib/analytics/content';
import { postEngagement, publicEngagement } from '@/lib/analytics/engagement';
import { formatSignedPercent } from '@/lib/analytics/format';
import { historyCovers, postingFrequency } from '@/lib/analytics/frequency';
import { latestFollowers, observedGrowth } from '@/lib/analytics/growth';
import {
  formatPeriod,
  observationTime,
  parseRangeParam,
  periodsFor,
  shiftPeriod,
} from '@/lib/analytics/range';
import { median, mean, relativeChange } from '@/lib/analytics/stats';
import type { FollowerObservation, Period, PostRecord } from '@/lib/analytics/types';

const DAY = 86_400_000;
const NOW = new Date('2026-11-06T12:00:00.000Z');
const period: Period = { start: new Date(NOW.getTime() - 30 * DAY), end: NOW };

const obs = (iso: string, value: number | null, extra: Partial<FollowerObservation> = {}) =>
  ({
    at: new Date(iso).toISOString(),
    value,
    availability: value === null ? 'error' : 'available',
    dataSource: 'live_public',
    ...extra,
  }) satisfies FollowerObservation;

let postNumber = 0;
type PostInput = Partial<Omit<PostRecord, 'likes' | 'comments'>> & {
  likes?: number | null | 'hidden';
  comments?: number | null;
};

function post(overrides: PostInput = {}): PostRecord {
  const { likes, comments, ...rest } = overrides;
  postNumber += 1;
  const source = rest.dataSource ?? 'live_public';
  return {
    id: `post-${postNumber}`,
    accountId: 'a',
    publishedAt: '2026-10-20T10:00:00.000Z',
    mediaFormat: 'image',
    permalink: null,
    caption: null,
    hashtags: [],
    dataSource: source,
    ...rest,
    likes:
      likes === undefined
        ? undefined
        : likes === 'hidden'
          ? { value: null, availability: 'hidden_by_owner', dataSource: source }
          : likes === null
            ? { value: null, availability: 'error', dataSource: source }
            : { value: likes, availability: 'available', dataSource: source },
    comments:
      comments === undefined
        ? undefined
        : comments === null
          ? { value: null, availability: 'error', dataSource: source }
          : { value: comments, availability: 'available', dataSource: source },
  };
}

describe('stats', () => {
  it('returns null, never zero, for empty input', () => {
    expect(median([])).toBeNull();
    expect(mean([])).toBeNull();
    expect(relativeChange(0, 5)).toBeNull();
    expect(relativeChange(null, 5)).toBeNull();
  });
  it('computes median and mean', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(mean([1, 2, 6])).toBe(3);
  });
});

describe('date ranges', () => {
  it('accepts 7, 30 and 90 days and defaults to 30', () => {
    expect(parseRangeParam('7')).toBe(7);
    expect(parseRangeParam(['90', '7'])).toBe(90);
    expect(parseRangeParam('365')).toBe(30);
    expect(parseRangeParam(undefined)).toBe(30);
  });
  it('builds two adjacent periods: the last 7 calendar days (today included) and the 7 before', () => {
    const { current, previous } = periodsFor(NOW, 7);
    expect(current.end).toEqual(NOW);
    expect(current.start.toISOString()).toBe('2026-10-31T00:00:00.000Z');
    expect(formatPeriod(current)).toBe('31 Oct – 6 Nov');
    expect(formatPeriod(previous)).toBe('24 Oct – 30 Oct');
    expect(previous.end).toEqual(current.start);
    expect(current.start.getTime() - previous.start.getTime()).toBe(7 * DAY);
    expect(shiftPeriod(current, 7).end.getTime()).toBe(NOW.getTime() - 7 * DAY);
  });
  it('dates a live observation at its capture time and a batch row at its metric date', () => {
    expect(observationTime('2026-10-07', '2026-10-07T06:00:00Z')).toBe('2026-10-07T06:00:00.000Z');
    expect(observationTime('2026-10-01', '2026-10-07T06:00:00Z')).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('observed follower growth', () => {
  it('uses the first and last observation inside the period (Jen’s example: +4.4%)', () => {
    const growth = observedGrowth(
      [
        obs('2026-10-01T06:00:00Z', 19_000), // before the period: ignored
        obs('2026-10-08T06:00:00Z', 20_400),
        obs('2026-10-20T06:00:00Z', 20_900),
        obs('2026-11-06T06:00:00Z', 21_300),
      ],
      period,
    );
    expect(growth.status).toBe('ok');
    if (growth.status !== 'ok') return;
    expect(growth.first).toEqual({ at: '2026-10-08T06:00:00.000Z', value: 20_400 });
    expect(growth.last).toEqual({ at: '2026-11-06T06:00:00.000Z', value: 21_300 });
    expect(growth.change).toBe(900);
    expect(formatSignedPercent(growth.rate!)).toBe('+4.4%');
    expect(growth.observations).toBe(3);
    expect(growth.dataSource).toBe('live_public');
  });

  it('needs two observations', () => {
    const growth = observedGrowth([obs('2026-10-20T06:00:00Z', 20_000)], period);
    expect(growth).toMatchObject({ status: 'unavailable', reason: 'not_enough_observations' });
  });

  it('needs the observations to be at least 24 hours apart', () => {
    const close = observedGrowth(
      [obs('2026-10-20T06:00:00Z', 20_000), obs('2026-10-21T05:59:00Z', 20_100)],
      period,
    );
    expect(close).toMatchObject({ status: 'unavailable', reason: 'not_enough_observations' });
    const apart = observedGrowth(
      [obs('2026-10-20T06:00:00Z', 20_000), obs('2026-10-21T06:00:00Z', 20_100)],
      period,
    );
    expect(apart.status).toBe('ok');
  });

  it('reports no observations instead of zero growth', () => {
    const growth = observedGrowth([], period);
    expect(growth).toMatchObject({ status: 'unavailable', reason: 'no_observations' });
    expect('rate' in growth).toBe(false);
  });

  it('skips unavailable values rather than reading them as zero', () => {
    const growth = observedGrowth(
      [
        obs('2026-10-10T06:00:00Z', 20_000),
        obs('2026-10-15T06:00:00Z', null),
        obs('2026-10-20T06:00:00Z', 20_200),
      ],
      period,
    );
    expect(growth).toMatchObject({ status: 'ok', change: 200, observations: 2 });
  });

  it('refuses to mix data sources', () => {
    expect(() =>
      observedGrowth(
        [
          obs('2026-10-10T06:00:00Z', 20_000),
          obs('2026-10-20T06:00:00Z', 20_200, { dataSource: 'live_connected' }),
        ],
        period,
      ),
    ).toThrow(/more than one data source/);
  });

  it('has no rate when the first value is zero', () => {
    const growth = observedGrowth(
      [obs('2026-10-10T06:00:00Z', 0), obs('2026-10-20T06:00:00Z', 10)],
      period,
    );
    expect(growth).toMatchObject({ status: 'ok', rate: null, change: 10 });
  });

  it('finds the latest observed count', () => {
    expect(
      latestFollowers([obs('2026-10-10T06:00:00Z', 1), obs('2026-10-12T06:00:00Z', null)]),
    ).toMatchObject({ value: 1 });
    expect(latestFollowers([])).toBeNull();
  });
});

describe('posting frequency', () => {
  const published = [
    '2026-10-01T10:00:00Z', // before the period
    '2026-10-10T10:00:00Z',
    '2026-10-15T10:00:00Z',
    '2026-10-22T10:00:00Z',
    '2026-11-01T10:00:00Z',
  ];

  it('counts posts per week over the whole period when history covers it', () => {
    const result = postingFrequency({
      publishedAt: published,
      earliestPostAt: '2026-01-01T00:00:00Z',
      period,
    });
    expect(result).toMatchObject({ status: 'ok', posts: 4, clipped: false });
    if (result.status === 'ok') expect(result.postsPerWeek).toBeCloseTo(4 / (30 / 7));
  });

  it('is unavailable while the post history start is unknown', () => {
    expect(
      postingFrequency({ publishedAt: published, earliestPostAt: null, period }),
    ).toMatchObject({
      status: 'unavailable',
      reason: 'history_start_unknown',
    });
  });

  it('refuses a period that starts before the known history', () => {
    const result = postingFrequency({
      publishedAt: published,
      earliestPostAt: '2026-10-14T00:00:00Z',
      period,
    });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'history_starts_after_range' });
  });

  it('clips to the known history when asked, and says so', () => {
    const result = postingFrequency({
      publishedAt: published,
      earliestPostAt: '2026-10-14T00:00:00Z',
      period,
      clip: true,
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.clipped).toBe(true);
    expect(result.clipNote).toMatch(/post history starts/);
    expect(result.posts).toBe(3); // 10 Oct is before the history start and isn't counted
    expect(result.from).toBe('2026-10-14T00:00:00.000Z');
    expect(result.weeks).toBeCloseTo(
      (NOW.getTime() - Date.parse('2026-10-14T00:00:00Z')) / (7 * DAY),
    );
  });

  it('stops at the last observation', () => {
    const result = postingFrequency({
      publishedAt: published,
      earliestPostAt: '2026-01-01T00:00:00Z',
      observedUntil: '2026-10-25T00:00:00Z',
      period,
    });
    expect(result).toMatchObject({ status: 'ok', posts: 3, clipped: true });
  });

  it('reports a 7-day period that ends now (slightly under 7 × 24 hours)', () => {
    const week = periodsFor(NOW, 7).current;
    const result = postingFrequency({
      publishedAt: ['2026-11-01T10:00:00Z', '2026-11-03T10:00:00Z'],
      earliestPostAt: '2026-01-01T00:00:00Z',
      observedUntil: '2026-11-06T06:00:00Z',
      period: week,
    });
    expect(result).toMatchObject({ status: 'ok', posts: 2, clipped: false });
  });

  it('does not report less than a week of history', () => {
    const result = postingFrequency({
      publishedAt: published,
      earliestPostAt: '2026-11-02T00:00:00Z',
      period,
      clip: true,
    });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'window_too_short' });
  });

  it('knows whether history covers a period', () => {
    expect(historyCovers(null, period)).toBe(false);
    expect(historyCovers('2026-10-01T00:00:00Z', period)).toBe(true);
    expect(historyCovers('2026-10-20T00:00:00Z', period)).toBe(false);
  });
});

describe('public engagement per post', () => {
  it('adds likes and comments', () => {
    expect(postEngagement(post({ likes: 100, comments: 5 }))).toMatchObject({
      status: 'ok',
      value: 105,
    });
  });

  it('never turns hidden likes or missing values into zero', () => {
    expect(postEngagement(post({ likes: 'hidden', comments: 5 }))).toEqual({
      status: 'hidden_by_owner',
    });
    expect(postEngagement(post({ comments: 5 }))).toEqual({ status: 'missing' });
    expect(postEngagement(post({ likes: null, comments: 5 }))).toEqual({ status: 'missing' });
  });

  it('reports median, mean, sample size and what was excluded', () => {
    const result = publicEngagement([
      post({ likes: 100, comments: 0 }),
      post({ likes: 200, comments: 10 }),
      post({ likes: 290, comments: 10 }),
      post({ likes: 'hidden', comments: 3 }),
      post({ likes: 'hidden', comments: 7 }),
      post({ comments: 1 }),
    ]);
    expect(result).toMatchObject({
      status: 'ok',
      median: 210,
      posts: 3,
      excludedHidden: 2,
      excludedMissing: 1,
      dataSource: 'live_public',
    });
    if (result.status === 'ok') expect(result.mean).toBeCloseTo(610 / 3);
  });

  it('is unavailable (not zero) when every post hides likes', () => {
    const result = publicEngagement([post({ likes: 'hidden', comments: 3 })]);
    expect(result).toMatchObject({
      status: 'unavailable',
      reason: 'no_posts_at_age',
      excludedHidden: 1,
    });
    expect('median' in result).toBe(false);
  });

  it('refuses to mix data sources', () => {
    expect(() =>
      publicEngagement([
        post({ likes: 1, comments: 1 }),
        post({ likes: 1, comments: 1, dataSource: 'live_connected' }),
      ]),
    ).toThrow(/more than one data source/);
  });
});

describe('format mix, top posts and hashtags', () => {
  it('shares posts by format', () => {
    const mix = formatMix([
      { mediaFormat: 'short_video' },
      { mediaFormat: 'short_video' },
      { mediaFormat: 'image' },
      { mediaFormat: 'carousel' },
    ]);
    expect(mix.total).toBe(4);
    expect(mix.formats[0]).toEqual({ format: 'short_video', posts: 2, share: 0.5 });
    expect(formatMix([])).toEqual({ total: 0, formats: [] });
  });

  it('ranks posts with a value and leaves out hidden likes', () => {
    const hidden = post({ likes: 'hidden', comments: 900 });
    const ranked = topPosts([
      post({ likes: 10, comments: 1 }),
      hidden,
      post({ likes: 50, comments: 2 }),
    ]);
    expect(ranked.map((r) => r.engagement)).toEqual([52, 11]);
    expect(ranked.some((r) => r.post.id === hidden.id)).toBe(false);
  });

  it('counts each hashtag once per post', () => {
    expect(
      hashtagCounts([
        { hashtags: ['grow', 'hydro'] },
        { hashtags: ['grow', 'Grow'] },
        { hashtags: [] },
      ]),
    ).toEqual([
      { tag: 'grow', posts: 2 },
      { tag: 'hydro', posts: 1 },
    ]);
  });
});

describe('comparability', () => {
  const followers = (
    platformKey: string,
    value: number | null,
    dataSource = 'live_public' as const,
  ) =>
    comparableValue({ platformKey, scope: 'account', metricKey: 'followers', dataSource, value });

  it('compares on public data in real organizations and on DEMO in demo ones', () => {
    expect(comparisonSource(false)).toBe('live_public');
    expect(comparisonSource(true)).toBe('demo');
    expect(postSources(false)).not.toContain('demo');
    expect(postSources(true)).toEqual(['demo']);
  });

  it('compares the same metric, class and source', () => {
    const result = compareValues(followers('instagram', 1200), followers('facebook', 1000));
    expect(result).toMatchObject({ status: 'compared', difference: 200, ratio: 1.2 });
  });

  it('refuses different sources (CANNA connected vs competitor public)', () => {
    const connected = comparableValue({
      platformKey: 'instagram',
      scope: 'account',
      metricKey: 'followers',
      dataSource: 'live_connected',
      value: 5000,
    });
    expect(checkComparable(connected, followers('instagram', 4000))).toEqual({
      ok: false,
      reason: 'different_source',
    });
  });

  it('refuses different comparability classes', () => {
    const publicViews = comparableValue({
      platformKey: 'instagram',
      scope: 'post',
      metricKey: 'views',
      sourceMetric: 'business_discovery.view_count',
      dataSource: 'live_public',
      value: 10,
    });
    const insightViews = comparableValue({
      platformKey: 'instagram',
      scope: 'post',
      metricKey: 'views',
      sourceMetric: 'views',
      dataSource: 'live_public',
      value: 10,
    });
    expect(compareValues(publicViews, insightViews)).toEqual({
      status: 'refused',
      reason: 'different_class',
    });
  });

  it('refuses different metrics and estimated values', () => {
    const likes = comparableValue({
      platformKey: 'instagram',
      scope: 'post',
      metricKey: 'likes',
      dataSource: 'live_public',
      value: 1,
    });
    expect(checkComparable(likes, followers('instagram', 1))).toMatchObject({
      reason: 'different_metric',
    });
    const estimated = { ...followers('instagram', 1), dataSource: 'estimated' as const };
    expect(checkComparable(estimated, estimated)).toMatchObject({ reason: 'estimated_source' });
  });

  it('marks a missing side as unavailable, never as zero', () => {
    expect(compareValues(followers('instagram', 100), followers('instagram', null))).toEqual({
      status: 'unavailable',
      missing: ['b'],
    });
  });

  it('summarizes groups with medians and counts missing values separately', () => {
    const result = summarizeGroups([
      { group: 'owned', value: followers('instagram', 100) },
      { group: 'owned', value: followers('instagram', 300) },
      { group: 'owned', value: followers('instagram', 10_000) },
      { group: 'competitor', value: followers('instagram', null) },
    ]);
    expect(result).toEqual({
      status: 'ok',
      groups: [
        { key: 'competitor', median: null, profiles: 0, unavailable: 1 },
        { key: 'owned', median: 300, profiles: 3, unavailable: 0 },
      ],
    });
  });

  it('refuses a group summary over incomparable values', () => {
    const result = summarizeGroups([
      { group: 'owned', value: followers('instagram', 100) },
      { group: 'competitor', value: followers('instagram', 100, 'demo' as 'live_public') },
    ]);
    expect(result).toEqual({ status: 'refused', reason: 'different_source' });
  });
});
