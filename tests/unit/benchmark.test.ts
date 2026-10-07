import { describe, expect, it } from 'vitest';
import {
  basisSentence,
  comparePeriods,
  countryBenchmark,
  formatDifference,
  measure,
  parseMetricParam,
  platformsOf,
  rankProfiles,
  summarizePeriodGroup,
  type BenchmarkProfileData,
} from '@/lib/analytics/benchmark';
import { buildBenchmarkView } from '@/lib/analytics/benchmark-view';
import { periodsFor } from '@/lib/analytics/range';
import type {
  BusinessRole,
  FollowerObservation,
  PostRecord,
  ProfileRecord,
} from '@/lib/analytics/types';

const DAY = 86_400_000;
const NOW = new Date('2026-10-07T12:00:00.000Z');
const periods = periodsFor(NOW, 30);
const period = periods.current;

function profile(id: string, overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    id,
    name: id,
    handle: id,
    platformKey: 'instagram',
    businessRole: 'competitor',
    accessType: 'public',
    countryCode: 'NL',
    isActive: true,
    firstObservedAt: '2026-07-01T00:00:00.000Z',
    lastObservedAt: '2026-10-07T08:00:00.000Z',
    earliestPostAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

/** One follower observation a day, from `fromDaysAgo` to `toDaysAgo`, growing by `step`. */
function dailyFollowers(
  start: number,
  step: number,
  fromDaysAgo: number,
  toDaysAgo = 0,
  source: FollowerObservation['dataSource'] = 'live_public',
): FollowerObservation[] {
  const list: FollowerObservation[] = [];
  for (let d = fromDaysAgo, i = 0; d >= toDaysAgo; d--, i++) {
    list.push({
      at: new Date(NOW.getTime() - d * DAY - 2 * 3_600_000).toISOString(),
      value: start + step * i,
      availability: 'available',
      dataSource: source,
    });
  }
  return list;
}

let postNumber = 0;
function post(accountId: string, daysAgo: number, likes: number | null, comments = 5): PostRecord {
  postNumber += 1;
  return {
    id: `p${postNumber}`,
    accountId,
    publishedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    mediaFormat: 'image',
    permalink: null,
    caption: null,
    hashtags: [],
    dataSource: 'live_public',
    likes:
      likes === null
        ? undefined
        : { value: likes, availability: 'available', dataSource: 'live_public' },
    comments:
      likes === null
        ? undefined
        : { value: comments, availability: 'available', dataSource: 'live_public' },
  };
}

function data(
  p: ProfileRecord,
  followers: FollowerObservation[] = [],
  posts: PostRecord[] = [],
): BenchmarkProfileData {
  return { profile: p, followers, posts };
}

describe('parseMetricParam', () => {
  it('accepts known metrics and falls back to observed growth', () => {
    expect(parseMetricParam('followers')).toBe('followers');
    expect(parseMetricParam(['posts_per_week'])).toBe('posts_per_week');
    expect(parseMetricParam('reach')).toBe('follower_growth');
    expect(parseMetricParam(undefined)).toBe('follower_growth');
  });
});

describe('measure', () => {
  it('measures observed growth from the first and last observation in the period', () => {
    const m = measure(
      'follower_growth',
      data(profile('a'), dailyFollowers(1000, 10, 20)),
      period,
      'live_public',
    );
    expect(m.status).toBe('ok');
    if (m.status !== 'ok') return;
    expect(m.value).toBeCloseTo(0.2);
    expect(m.sampleSize).toBe(21);
    expect(m.sources).toEqual(['live_public']);
    expect(m.comparable.metricKey).toBe('follower_growth_rate');
  });

  it('ignores values of another data source instead of mixing them', () => {
    const followers = [
      ...dailyFollowers(1000, 10, 20, 0, 'live_connected'),
      ...dailyFollowers(500, 1, 0, 0, 'live_public'),
    ];
    const m = measure('follower_growth', data(profile('a'), followers), period, 'live_public');
    expect(m).toMatchObject({ status: 'unavailable', reason: 'not_enough_observations' });
  });

  it('does not rank posts per week when the post history starts after the period', () => {
    const p = profile('a', { earliestPostAt: new Date(NOW.getTime() - 10 * DAY).toISOString() });
    const m = measure('posts_per_week', data(p, [], [post('a', 3, 1)]), period, 'live_public');
    expect(m).toMatchObject({ status: 'unavailable', reason: 'history_starts_after_range' });
  });

  it('counts posts per week over the whole period', () => {
    const posts = Array.from({ length: 10 }, (_, i) => post('a', i * 2 + 1, 1));
    const m = measure('posts_per_week', data(profile('a'), [], posts), period, 'live_public');
    expect(m.status).toBe('ok');
    if (m.status === 'ok') expect(m.sampleSize).toBe(10);
  });

  it('needs five posts measured at 7 days for median engagement', () => {
    const few = [post('a', 10, 100), post('a', 12, 200)];
    expect(
      measure('median_engagement', data(profile('a'), [], few), period, 'live_public'),
    ).toMatchObject({
      status: 'unavailable',
      reason: 'too_few_posts',
    });
    const enough = [10, 12, 14, 16, 18].map((d, i) => post('a', d, 100 * (i + 1), 0));
    const m = measure('median_engagement', data(profile('a'), [], enough), period, 'live_public');
    expect(m).toMatchObject({ status: 'ok', value: 300, sampleSize: 5 });
  });

  it('says when likes are hidden by the owner instead of counting them as 0', () => {
    const hidden = [10, 12, 14].map((d) => ({
      ...post('a', d, 1),
      likes: {
        value: null,
        availability: 'hidden_by_owner' as const,
        dataSource: 'live_public' as const,
      },
    }));
    expect(
      measure('median_engagement', data(profile('a'), [], hidden), period, 'live_public'),
    ).toMatchObject({ status: 'unavailable', label: 'likes hidden by owner' });
  });

  it('uses the last follower observation inside the period, never one from outside', () => {
    const outside = dailyFollowers(900, 0, 40, 35);
    expect(measure('followers', data(profile('a'), outside), period, 'live_public')).toMatchObject({
      status: 'unavailable',
      reason: 'no_observations',
    });
    const m = measure(
      'followers',
      data(profile('a'), dailyFollowers(1000, 10, 5)),
      period,
      'live_public',
    );
    expect(m).toMatchObject({ status: 'ok', value: 1050 });
  });
});

describe('rankProfiles', () => {
  const input = () => [
    data(profile('alpha'), dailyFollowers(1000, 10, 20)), // +20%
    data(profile('bravo'), dailyFollowers(2000, 20, 20)), // +20% (tie)
    data(profile('charlie'), dailyFollowers(1000, 1, 20)), // +2.1%
    data(profile('delta')), // nothing observed
    data(profile('echo', { platformKey: 'facebook' }), dailyFollowers(100, 10, 20)),
    data(profile('foxtrot', { isActive: false }), dailyFollowers(100, 50, 20)),
  ];

  it('ranks only comparable values on one platform and lists everyone else with a reason', () => {
    const ranking = rankProfiles({
      metric: 'follower_growth',
      platformKey: 'instagram',
      data: input(),
      period,
      source: 'live_public',
      setLabel: 'all monitored profiles',
    });
    expect(ranking.ranked.map((r) => [r.rank, r.profile.id])).toEqual([
      [1, 'alpha'],
      [1, 'bravo'],
      [3, 'charlie'],
    ]);
    const excluded = Object.fromEntries(ranking.excluded.map((e) => [e.profile.id, e.reason]));
    expect(excluded).toEqual({
      delta: 'unavailable',
      echo: 'other_platform',
      foxtrot: 'paused',
    });
  });

  it('never ranks a missing value as zero', () => {
    const ranking = rankProfiles({
      metric: 'follower_growth',
      platformKey: 'instagram',
      data: [data(profile('a'), dailyFollowers(1000, -5, 20)), data(profile('b'))],
      period,
      source: 'live_public',
      setLabel: 'all monitored profiles',
    });
    expect(ranking.ranked).toHaveLength(1);
    expect(ranking.ranked[0]!.value).toBeLessThan(0);
    expect(ranking.excluded[0]).toMatchObject({
      reason: 'unavailable',
      label: 'not observed in this period',
    });
  });

  it('refuses values from a different source than the comparison source', () => {
    const ranking = rankProfiles({
      metric: 'followers',
      platformKey: 'instagram',
      data: [data(profile('a'), dailyFollowers(1000, 10, 5, 0, 'demo'))],
      period,
      source: 'live_public',
      setLabel: 'all monitored profiles',
    });
    expect(ranking.ranked).toHaveLength(0);
    expect(ranking.excluded[0]!.reason).toBe('unavailable');
  });

  it('states its basis in one sentence', () => {
    expect(
      basisSentence({
        metric: 'follower_growth',
        platformKey: 'instagram',
        period: { start: new Date('2026-09-08T00:00:00Z'), end: new Date('2026-10-07T12:00:00Z') },
        source: 'live_public',
        setLabel: 'all monitored profiles',
      }),
    ).toBe(
      'Ranked by observed follower growth, 8 Sept – 7 Oct, PUBLIC data, Instagram only, all monitored profiles.',
    );
    expect(
      basisSentence({
        metric: 'median_engagement',
        platformKey: 'instagram',
        period,
        source: 'demo',
        setLabel: 'group “Spain”',
      }),
    ).toMatch(
      /likes \+ comments at 7 days old.*DEMO data, Instagram only, group “Spain”; profiles need at least 5/,
    );
  });
});

describe('countryBenchmark', () => {
  it('gives medians per country with counts, own vs competitors', () => {
    const role = (r: BusinessRole) => r;
    const ranking = rankProfiles({
      metric: 'followers',
      platformKey: 'instagram',
      data: [
        data(profile('nl-own', { businessRole: role('owned') }), dailyFollowers(1000, 0, 2)),
        data(profile('nl-c1'), dailyFollowers(3000, 0, 2)),
        data(profile('nl-c2'), dailyFollowers(5000, 0, 2)),
        data(profile('nl-c3')),
        data(profile('es-c1', { countryCode: 'ES' }), dailyFollowers(200, 0, 2)),
        data(profile('none', { countryCode: null }), dailyFollowers(10, 0, 2)),
        data(profile('fb', { platformKey: 'facebook' }), dailyFollowers(10, 0, 2)),
      ],
      period,
      source: 'live_public',
      setLabel: 'all monitored profiles',
    });
    const rows = countryBenchmark(ranking);
    expect(rows.map((r) => r.countryCode)).toEqual(['NL', 'ES', null]);
    const nl = rows[0]!;
    expect(nl.own).toMatchObject({ median: 1000, profiles: 1, unavailable: 0 });
    expect(nl.competitors).toMatchObject({ median: 4000, profiles: 2, unavailable: 1 });
    expect(nl.all).toMatchObject({ median: 3000, profiles: 3, unavailable: 1 });
    expect(rows[1]!.own).toMatchObject({ median: null, profiles: 0 });
  });
});

describe('comparePeriods', () => {
  it('compares both periods with their sample sizes', () => {
    const row = comparePeriods({
      metric: 'followers',
      data: data(profile('a'), dailyFollowers(1000, 10, 50)),
      periods,
      source: 'live_public',
    });
    expect(row.current).toMatchObject({ status: 'ok', value: 1500 });
    expect(row.previous.status).toBe('ok');
    expect(row.change.status).toBe('compared');
    if (row.change.status === 'compared') {
      expect(row.change.difference).toBe(300);
      expect(row.change.relative).toBeCloseTo(300 / 1200);
    }
  });

  it('says "not enough observations" instead of inventing the previous period', () => {
    const row = comparePeriods({
      metric: 'follower_growth',
      data: data(profile('a'), dailyFollowers(1000, 10, 20)),
      periods,
      source: 'live_public',
    });
    expect(row.current.status).toBe('ok');
    expect(row.previous).toMatchObject({ status: 'unavailable', reason: 'no_observations' });
    expect(row.change).toEqual({ status: 'not_enough', missing: ['previous'] });
  });

  it('summarizes groups only over profiles with both periods', () => {
    const rows = [
      comparePeriods({
        metric: 'followers',
        data: data(profile('a'), dailyFollowers(1000, 10, 50)),
        periods,
        source: 'live_public',
      }),
      comparePeriods({
        metric: 'followers',
        data: data(profile('b'), dailyFollowers(100, 1, 10)),
        periods,
        source: 'live_public',
      }),
    ];
    const summary = summarizePeriodGroup('set', 'All', rows);
    expect(summary).toMatchObject({ profiles: 2, paired: 1, notEnough: 1, currentMedian: 1500 });
  });

  it('formats growth differences in percentage points', () => {
    expect(formatDifference('follower_growth', 0.012)).toBe('+1.2 pp');
    expect(formatDifference('followers', -300)).toBe('−300');
  });
});

describe('buildBenchmarkView', () => {
  const profiles = [
    profile('ig1'),
    profile('ig2', { businessRole: 'owned' }),
    profile('fb1', { platformKey: 'facebook' }),
    profile('paused', { isActive: false }),
  ];
  const map = new Map(profiles.map((p) => [p.id, data(p, dailyFollowers(1000, 10, 50))]));

  it('ranks the largest platform of all active profiles by default', () => {
    const view = buildBenchmarkView({
      metric: 'follower_growth',
      set: undefined,
      platform: undefined,
      days: 30,
      now: NOW,
      source: 'live_public',
      profiles,
      data: map,
      groups: [{ id: 'g1', name: 'Mixed', memberIds: ['fb1', 'paused'] }],
    });
    expect(view.platformKey).toBe('instagram');
    expect(view.setProfiles.map((p) => p.id)).toEqual(['ig1', 'ig2', 'fb1']);
    expect(view.ranking!.ranked).toHaveLength(2);
    expect(view.periodGroups.map((g) => g.label)).toEqual([
      'All monitored profiles',
      'Own profiles',
      'Competitors',
    ]);
  });

  it('uses a group as the set, keeps its paused members visible, and falls back to its platform', () => {
    const view = buildBenchmarkView({
      metric: 'followers',
      set: 'g1',
      platform: 'facebook',
      days: 30,
      now: NOW,
      source: 'live_public',
      profiles,
      data: map,
      groups: [{ id: 'g1', name: 'Mixed', memberIds: ['fb1', 'paused'] }],
    });
    expect(view.setLabel).toBe('group “Mixed”');
    expect(view.platformKey).toBe('facebook');
    expect(view.ranking!.ranked.map((r) => r.profile.id)).toEqual(['fb1']);
    expect(view.ranking!.excluded.map((e) => [e.profile.id, e.reason])).toEqual([
      ['paused', 'other_platform'],
    ]);
  });

  it('lists platforms with most profiles first', () => {
    expect(platformsOf(profiles)).toEqual([
      { key: 'instagram', count: 3 },
      { key: 'facebook', count: 1 },
    ]);
  });
});
