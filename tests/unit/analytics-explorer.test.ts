import { describe, expect, it } from 'vitest';
import {
  buildExplorer,
  buildExplorerView,
  exclusionSentence,
  explorerHref,
  filterPosts,
  metricOptions,
  postValue,
  type ExplorerFilters,
  type ExplorerPost,
  type StoredPostMetric,
} from '@/lib/analytics/explorer';
import { periodsFor } from '@/lib/analytics/range';
import type { DataSource, ProfileRecord } from '@/lib/analytics/types';

const DAY = 86_400_000;
const NOW = new Date('2026-10-07T12:00:00.000Z');
const period = periodsFor(NOW, 30).current;
const names = {
  countries: new Map([
    ['NL', 'Netherlands'],
    ['ES', 'Spain'],
  ]),
  pillars: new Map([['p1', 'Grow knowledge']]),
  campaigns: new Map<string, string>(),
};
const noFilters: ExplorerFilters = {
  platform: null,
  country: null,
  role: null,
  format: null,
  pillar: null,
  campaign: null,
};

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
    firstObservedAt: null,
    lastObservedAt: null,
    earliestPostAt: null,
    ...overrides,
  };
}

let counter = 0;
function post(
  owner: ProfileRecord,
  metrics: Record<string, number | null | StoredPostMetric['availability']>,
  overrides: Partial<ExplorerPost> = {},
  source: DataSource = 'live_public',
): ExplorerPost {
  counter++;
  return {
    id: `post-${counter}`,
    profile: owner,
    publishedAt: new Date(NOW.getTime() - (counter % 20) * DAY).toISOString(),
    mediaFormat: 'image',
    permalink: null,
    caption: `Caption ${counter}`,
    countryCode: owner.countryCode,
    pillarId: null,
    campaignId: null,
    metrics: Object.entries(metrics).map(([metricKey, value]) =>
      typeof value === 'string'
        ? { metricKey, value: null, availability: value, dataSource: source }
        : { metricKey, value, availability: 'available', dataSource: source },
    ),
    ...overrides,
  };
}

const nl = profile('nl');
const es = profile('es', { countryCode: 'ES' });

describe('postValue', () => {
  it('reads only available values of the chosen source', () => {
    const p = post(nl, { likes: 10, reach: 'not_public', views: 'not_applicable' });
    expect(postValue(p, 'likes', 'live_public')).toMatchObject({ status: 'ok', value: 10 });
    expect(postValue(p, 'likes', 'live_connected')).toEqual({
      status: 'excluded',
      reason: 'not_stored',
    });
    expect(postValue(p, 'reach', 'live_public')).toEqual({
      status: 'excluded',
      reason: 'not_public',
    });
    expect(postValue(p, 'views', 'live_public')).toEqual({
      status: 'excluded',
      reason: 'not_applicable',
    });
    expect(postValue(p, 'saves', 'live_public')).toEqual({
      status: 'excluded',
      reason: 'not_stored',
    });
  });

  it('computes public engagement and never turns hidden likes into 0', () => {
    expect(
      postValue(post(nl, { likes: 10, comments: 2 }), 'public_engagement', 'live_public'),
    ).toMatchObject({ status: 'ok', value: 12 });
    expect(
      postValue(
        post(nl, { likes: 'hidden_by_owner', comments: 2 }),
        'public_engagement',
        'live_public',
      ),
    ).toEqual({ status: 'excluded', reason: 'hidden_by_owner' });
    expect(postValue(post(nl, { likes: 3 }), 'public_engagement', 'live_public')).toEqual({
      status: 'excluded',
      reason: 'not_stored',
    });
  });
});

describe('buildExplorer', () => {
  it('gives post count, median, mean and top three per group, sorted by median', () => {
    const posts = [
      ...[1, 2, 3, 4, 100].map((likes) => post(nl, { likes })),
      ...[10, 20, 30, 40, 50, 60].map((likes) => post(es, { likes })),
      post(es, { likes: 'hidden_by_owner' }),
    ];
    const result = buildExplorer({
      posts,
      metricKey: 'likes',
      source: 'live_public',
      compareBy: 'country',
      period,
      filters: noFilters,
      names,
    });
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.groups.map((g) => [g.label, g.posts, g.median, g.mean, g.excluded])).toEqual([
      ['Spain', 6, 35, 35, 1],
      ['Netherlands', 5, 3, 22, 0],
    ]);
    expect(result.groups[1]!.top.map((t) => t.value)).toEqual([100, 4, 3]);
    expect(result.excluded).toEqual([{ reason: 'hidden_by_owner', posts: 1 }]);
    expect(result.exclusionNote).toContain('1 post left out');
    expect(result.exclusionNote).toContain('not counted as 0');
    expect(result.basis).toContain('Median and mean likes per post');
    expect(result.basis).toContain('11 posts');
    expect(result.basis).toContain('PUBLIC data');
    expect(result.basis).toContain('by country');
  });

  it('shows no median or mean for groups with fewer than five posts', () => {
    const result = buildExplorer({
      posts: [post(nl, { likes: 5 }), post(nl, { likes: 7 })],
      metricKey: 'likes',
      source: 'live_public',
      compareBy: 'profile',
      period,
      filters: noFilters,
      names,
    });
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.groups[0]).toMatchObject({ posts: 2, median: null, mean: null });
    expect(result.groups[0]!.top).toHaveLength(2);
  });

  it('refuses to mix platforms whose values are measured differently', () => {
    const yt = profile('yt', { platformKey: 'youtube' });
    const result = buildExplorer({
      posts: [post(nl, { views: 10 }), post(yt, { views: 20 }), post(yt, { views: 30 })],
      metricKey: 'views',
      source: 'live_public',
      compareBy: 'country',
      period,
      filters: noFilters,
      names,
    });
    expect(result).toMatchObject({ status: 'refused', reason: 'different_class' });
    if (result.status === 'refused') {
      expect(result.platforms).toEqual([
        { key: 'youtube', count: 2 },
        { key: 'instagram', count: 1 },
      ]);
    }
  });

  it('compares likes across platforms that share the class', () => {
    const yt = profile('yt', { platformKey: 'youtube' });
    const result = buildExplorer({
      posts: [post(nl, { likes: 10 }), post(yt, { likes: 20 })],
      metricKey: 'likes',
      source: 'live_public',
      compareBy: 'platform',
      period,
      filters: noFilters,
      names,
    });
    expect(result.status).toBe('ok');
  });

  it('reports posts without values and posts without a group', () => {
    expect(
      buildExplorer({
        posts: [post(nl, { likes: 'hidden_by_owner' }), post(nl, {})],
        metricKey: 'likes',
        source: 'live_public',
        compareBy: 'country',
        period,
        filters: noFilters,
        names,
      }),
    ).toEqual({
      status: 'no_values',
      posts: 2,
      excluded: [
        { reason: 'hidden_by_owner', posts: 1 },
        { reason: 'not_stored', posts: 1 },
      ],
    });
    const tagged = buildExplorer({
      posts: [post(nl, { likes: 1 }, { pillarId: 'p1' }), post(nl, { likes: 2 })],
      metricKey: 'likes',
      source: 'live_public',
      compareBy: 'pillar',
      period,
      filters: noFilters,
      names,
    });
    if (tagged.status !== 'ok') throw new Error(tagged.status);
    expect(tagged.groups.map((g) => g.label)).toEqual(['Grow knowledge']);
    expect(tagged.ungrouped).toBe(1);
    expect(buildExplorer({ ...baseInput(), posts: [] })).toEqual({ status: 'no_posts' });
  });
});

function baseInput() {
  return {
    metricKey: 'likes',
    source: 'live_public' as const,
    compareBy: 'country' as const,
    period,
    filters: noFilters,
    names,
  };
}

describe('metric options and filters', () => {
  it('offers only metrics with values, and flags those not comparable across platforms', () => {
    const yt = profile('yt', { platformKey: 'youtube' });
    const options = metricOptions(
      [
        post(nl, { likes: 1, comments: 1, views: 4, reach: 'not_public' }),
        post(yt, { likes: 2, views: 5 }),
      ],
      'live_public',
    );
    expect(options.map((o) => [o.key, o.posts, o.comparable])).toEqual([
      ['views', 2, false],
      ['likes', 2, true],
      ['comments', 1, true],
      ['public_engagement', 1, true],
    ]);
  });

  it('filters by period, platform, country, role, format and pillar', () => {
    const own = profile('own', { businessRole: 'owned' });
    const old = post(
      nl,
      { likes: 1 },
      { publishedAt: new Date(NOW.getTime() - 40 * DAY).toISOString() },
    );
    const reel = post(own, { likes: 1 }, { mediaFormat: 'short_video', pillarId: 'p1' });
    const photo = post(es, { likes: 1 });
    const all = [old, reel, photo];
    expect(filterPosts(all, noFilters, period)).toEqual([reel, photo]);
    expect(filterPosts(all, { ...noFilters, country: 'ES' }, period)).toEqual([photo]);
    expect(filterPosts(all, { ...noFilters, role: 'owned' }, period)).toEqual([reel]);
    expect(filterPosts(all, { ...noFilters, format: 'short_video' }, period)).toEqual([reel]);
    expect(filterPosts(all, { ...noFilters, pillar: 'p1' }, period)).toEqual([reel]);
    expect(filterPosts(all, { ...noFilters, platform: 'youtube' }, period)).toEqual([]);
  });
});

describe('buildExplorerView', () => {
  const yt = profile('yt', { platformKey: 'youtube' });
  const posts = [
    post(nl, { likes: 1, views: 3 }),
    post(nl, { likes: 2 }),
    post(yt, { likes: 3, views: 9 }),
  ];
  const input = {
    posts,
    sources: ['live_public' as const],
    period,
    hasPillars: true,
    hasCampaigns: false,
    names,
  };

  it('opens on the platform with the most posts and on likes', () => {
    const view = buildExplorerView({ ...input, search: {} });
    expect(view.filters.platform).toBe('instagram');
    expect(view.metricKey).toBe('likes');
    expect(view.compareBy).toBe('country');
    expect(view.compareOptions).not.toContain('campaign');
    expect(view.posts).toHaveLength(2);
  });

  it('hides metrics that are not comparable across all platforms', () => {
    const view = buildExplorerView({ ...input, search: { platform: 'all' } });
    expect(view.metrics.map((m) => m.key)).not.toContain('views');
    expect(view.notComparable.map((m) => m.key)).toEqual(['views']);
    const refused = buildExplorerView({ ...input, search: { platform: 'all', metric: 'views' } });
    expect(refused.explorer.status).toBe('refused');
  });

  it('ignores filter values the posts do not carry', () => {
    const view = buildExplorerView({
      ...input,
      search: {
        country: 'XX',
        role: 'nobody',
        format: 'image',
        compare: 'campaign',
        source: 'demo',
      },
    });
    expect(view.filters).toMatchObject({ country: null, role: null, format: 'image' });
    expect(view.compareBy).toBe('country');
    expect(view.source).toBe('live_public');
  });
});

describe('exclusionSentence and explorerHref', () => {
  it('says how many posts were left out and why', () => {
    expect(exclusionSentence('likes', [])).toBeNull();
    expect(
      exclusionSentence('likes', [
        { reason: 'hidden_by_owner', posts: 8 },
        { reason: 'not_stored', posts: 4 },
      ]),
    ).toBe(
      '12 posts left out because likes have no value (8 hidden by the owner, 4 no stored value); they are not counted as 0.',
    );
  });

  it('keeps the current choices and drops empty ones', () => {
    expect(
      explorerHref('canna', { range: '30', country: null, metric: 'likes' }, { platform: 'x' }),
    ).toBe('/canna/analytics?range=30&metric=likes&platform=x');
  });
});
