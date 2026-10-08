import { describe, expect, it } from 'vitest';
import type { ProfileRecord } from '@/lib/analytics/types';
import {
  computeCoverage,
  inStrategyScope,
  strategyPeriod,
  verdictFor,
  type CoverageItem,
  type StrategyScope,
} from '@/lib/strategy/coverage';
import { measureObjective, type OwnProfileData } from '@/lib/strategy/progress';

const TZ = 'Europe/Amsterdam';
const scope: StrategyScope = {
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  countryCodes: ['NL'],
  platformKeys: ['instagram'],
};
let n = 0;
const item = (over: Partial<CoverageItem>): CoverageItem => ({
  id: `item-${(n += 1)}`,
  status: 'DRAFT',
  pillarId: 'grow',
  countryCode: 'NL',
  platformKeys: ['instagram'],
  plannedPublishAt: '2026-10-10T07:00:00Z',
  publishedAt: null,
  ...over,
});
const period = strategyPeriod(scope, TZ);

describe('strategy scope', () => {
  it('uses whole days in the organization’s time zone', () => {
    expect(period.start.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-10-31T23:00:00.000Z');
  });

  it('counts content dated in the period, in its markets and platforms', () => {
    expect(inStrategyScope(item({}), scope, period)).toBe(true);
    expect(inStrategyScope(item({ countryCode: null }), scope, period)).toBe(true);
    expect(inStrategyScope(item({ countryCode: 'DE' }), scope, period)).toBe(false);
    expect(inStrategyScope(item({ platformKeys: ['youtube'] }), scope, period)).toBe(false);
    expect(inStrategyScope(item({ plannedPublishAt: null }), scope, period)).toBe(false);
    expect(inStrategyScope(item({ status: 'ARCHIVED' }), scope, period)).toBe(false);
    expect(inStrategyScope(item({ status: 'REJECTED' }), scope, period)).toBe(false);
    // The published date wins over the plan.
    expect(
      inStrategyScope(
        item({ plannedPublishAt: '2026-11-03T08:00:00Z', publishedAt: '2026-10-31T21:00:00Z' }),
        scope,
        period,
      ),
    ).toBe(true);
  });
});

describe('coverage', () => {
  const pillars = [
    { pillarId: 'grow', name: 'Grow knowledge', color: 'green', targetShare: 50 },
    { pillarId: 'product', name: 'Product stories', color: 'blue', targetShare: 30 },
  ];
  const names = new Map([['community', { name: 'Community', color: 'amber' }]]);

  it('splits content by pillar against targets', () => {
    const coverage = computeCoverage({
      items: [
        item({ status: 'PUBLISHED', publishedAt: '2026-10-05T08:00:00Z' }),
        item({}),
        item({}),
        item({ pillarId: 'community' }),
        item({ pillarId: null }),
        item({ countryCode: 'DE' }),
      ],
      scope,
      pillars,
      pillarNames: names,
      timeZone: TZ,
    });
    expect(coverage).toMatchObject({
      total: 5,
      planned: 4,
      published: 1,
      comparable: true,
      targetTotal: 80,
    });
    expect(coverage.rows.map((r) => [r.name, r.total, r.share, r.verdict])).toEqual([
      ['Grow knowledge', 3, 60, 'over'],
      ['Product stories', 0, 0, 'under'],
      ['Community', 1, 20, 'no_target'],
      ['No pillar', 1, 20, 'no_target'],
    ]);
  });

  it('doesn’t judge shares on a handful of items', () => {
    const coverage = computeCoverage({
      items: [item({}), item({ pillarId: 'product' })],
      scope,
      pillars,
      pillarNames: names,
      timeZone: TZ,
    });
    expect(coverage.comparable).toBe(false);
    expect(coverage.rows.every((r) => r.verdict === null)).toBe(true);
  });

  it('calls shares within five points on target', () => {
    expect(verdictFor(46, 50)).toBe('on_target');
    expect(verdictFor(44, 50)).toBe('under');
    expect(verdictFor(56, 50)).toBe('over');
  });
});

describe('objective progress', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  const profile = (over: Partial<ProfileRecord>): ProfileRecord => ({
    id: 'p1',
    name: 'CANNA NL',
    handle: 'canna_nl',
    platformKey: 'instagram',
    businessRole: 'owned',
    accessType: 'public',
    countryCode: 'NL',
    isActive: true,
    firstObservedAt: '2026-09-01T06:00:00Z',
    lastObservedAt: '2026-10-16T06:00:00Z',
    earliestPostAt: '2026-01-01T00:00:00Z',
    ...over,
  });
  const followers = (values: [string, number][]) =>
    values.map(([at, value]) => ({
      at,
      value,
      availability: 'available' as const,
      dataSource: 'live_public' as const,
    }));
  const profiles: OwnProfileData[] = [
    {
      profile: profile({}),
      followers: followers([
        ['2026-10-01T06:00:00Z', 1000],
        ['2026-10-15T06:00:00Z', 1150],
      ]),
      posts: [{ publishedAt: '2026-10-03T10:00:00Z' }, { publishedAt: '2026-10-10T10:00:00Z' }],
    },
    {
      profile: profile({ id: 'p2', name: 'CANNA NL new', firstObservedAt: '2026-10-15T06:00:00Z' }),
      followers: followers([['2026-10-15T06:00:00Z', 50]]),
      posts: [],
    },
    {
      profile: profile({ id: 'p3', name: 'Rival', businessRole: 'competitor' }),
      followers: [],
      posts: [],
    },
    {
      profile: profile({ id: 'p4', name: 'CANNA DE', countryCode: 'DE' }),
      followers: [],
      posts: [],
    },
  ];
  const base = { scope, timeZone: TZ, now, items: [] as CoverageItem[], profiles };

  it('adds up observed follower growth and names what was left out', () => {
    const result = measureObjective({
      ...base,
      objective: { id: 'o', name: 'Grow', kpi: 'follower_growth', targetValue: 600 },
    });
    expect(result).toMatchObject({ status: 'measured', value: 150, target: 600, ratio: 0.25 });
    if (result.status !== 'measured') throw new Error();
    expect(result.leftOut.map((p) => p.name)).toEqual(['CANNA NL new']);
    expect(result.expectedByNow).toBeGreaterThan(200);
  });

  it('counts published content in scope', () => {
    const result = measureObjective({
      ...base,
      items: [item({ status: 'PUBLISHED', publishedAt: '2026-10-05T08:00:00Z' }), item({})],
      objective: { id: 'o', name: 'Publish', kpi: 'published_content', targetValue: 10 },
    });
    expect(result).toMatchObject({ status: 'measured', value: 1, ratio: 0.1 });
  });

  it('says why when nothing can be measured, instead of showing zero', () => {
    const result = measureObjective({
      ...base,
      profiles: [profiles[1]!],
      objective: { id: 'o', name: 'Grow', kpi: 'follower_growth', targetValue: 600 },
    });
    expect(result.status).toBe('unavailable');
    const none = measureObjective({
      ...base,
      profiles: [profiles[3]!],
      objective: { id: 'o', name: 'Grow', kpi: 'posts_per_week', targetValue: 3 },
    });
    expect(none).toMatchObject({ status: 'unavailable', reason: /None of your own profiles/ });
  });

  it('waits for the period to start, and shows manual targets as they are', () => {
    expect(
      measureObjective({
        ...base,
        now: new Date('2026-09-20T00:00:00Z'),
        objective: { id: 'o', name: 'Publish', kpi: 'published_content', targetValue: 10 },
      }),
    ).toEqual({ status: 'not_started', startsOn: '2026-10-01', target: 10 });
    expect(
      measureObjective({
        ...base,
        objective: { id: 'o', name: 'Brand', kpi: 'manual', targetValue: null },
      }),
    ).toEqual({ status: 'manual', target: null });
  });
});
