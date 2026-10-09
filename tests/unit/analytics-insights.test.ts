import { describe, expect, it } from 'vitest';
import { buildDashboard, type DashboardInput } from '@/lib/analytics/dashboard';
import { generateInsights, type ProfileInsightInput } from '@/lib/analytics/insights';
import { periodsFor } from '@/lib/analytics/range';
import type {
  DataSource,
  FollowerObservation,
  MediaFormat,
  PostRecord,
  ProfileRecord,
} from '@/lib/analytics/types';

const DAY = 86_400_000;
const NOW = new Date('2026-11-06T12:00:00.000Z');
const SOURCE: DataSource = 'live_public';
const CAUSAL =
  /\b(because|due to|caused|causes|led to|leads to|drove|driven|resulted in|result of|thanks to|as a result|so that|therefore|boosted|impact)\b/i;

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
    firstObservedAt: '2026-08-01T06:00:00.000Z',
    lastObservedAt: '2026-11-06T06:00:00.000Z',
    earliestPostAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** One observation per day at 06:00 for `days` days ending today, growing by `daily(i)`. */
function dailyFollowers(start: number, days: number, daily: (dayIndex: number) => number) {
  const out: FollowerObservation[] = [];
  let value = start;
  for (let i = days; i >= 0; i--) {
    const at = new Date(Date.UTC(2026, 10, 6, 6) - i * DAY).toISOString();
    out.push({ at, value: Math.round(value), availability: 'available', dataSource: SOURCE });
    value += daily(i);
  }
  return out;
}

let n = 0;
function posts(
  accountId: string,
  count: number,
  opts: {
    daysAgoFrom: number;
    daysAgoTo: number;
    format?: MediaFormat;
    likes?: number | 'hidden';
    comments?: number;
  },
): PostRecord[] {
  const out: PostRecord[] = [];
  for (let i = 0; i < count; i++) {
    n += 1;
    const span = opts.daysAgoFrom - opts.daysAgoTo;
    const daysAgo = opts.daysAgoFrom - (span * (i + 0.5)) / count;
    const likes = opts.likes ?? 100;
    out.push({
      id: `p${n}`,
      accountId,
      publishedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
      mediaFormat: opts.format ?? 'image',
      permalink: `https://www.instagram.com/p/${n}/`,
      caption: null,
      hashtags: [],
      dataSource: SOURCE,
      likes:
        likes === 'hidden'
          ? { value: null, availability: 'hidden_by_owner', dataSource: SOURCE }
          : { value: likes + i, availability: 'available', dataSource: SOURCE },
      comments: { value: opts.comments ?? 10, availability: 'available', dataSource: SOURCE },
    });
  }
  return out;
}

function fixture(): DashboardInput {
  n = 0;
  const own = profile('own', { name: 'CANNA NL', businessRole: 'owned', accessType: 'connected' });
  const rival = profile('rival', { name: 'Hydro Rival' });
  const small = profile('small', { name: 'Small Shop' });
  const fresh = profile('fresh', {
    name: 'Fresh Add',
    firstObservedAt: '2026-11-06T06:00:00.000Z',
    earliestPostAt: null,
  });
  const followers = new Map<string, FollowerObservation[]>([
    // Own: +10/day in the previous period, +40/day in this one.
    ['own', dailyFollowers(20_000, 70, (i) => (i > 30 ? 10 : 40))],
    // Rival: steady.
    ['rival', dailyFollowers(50_000, 70, () => 20)],
    ['small', dailyFollowers(1_000, 70, () => 1)],
    // Added today: a single observation.
    ['fresh', dailyFollowers(9_000, 0, () => 0)],
  ]);
  const allPosts = [
    // Own: previous period 5 images; this period 4 Reels + 4 images, more engagement.
    ...posts('own', 5, { daysAgoFrom: 58, daysAgoTo: 38, likes: 100 }),
    ...posts('own', 4, { daysAgoFrom: 29, daysAgoTo: 8, format: 'short_video', likes: 200 }),
    ...posts('own', 4, { daysAgoFrom: 29, daysAgoTo: 8, likes: 180 }),
    // Rival: many posts, much higher engagement, one with hidden likes.
    ...posts('rival', 10, { daysAgoFrom: 58, daysAgoTo: 38, likes: 600 }),
    ...posts('rival', 12, { daysAgoFrom: 29, daysAgoTo: 8, likes: 650 }),
    ...posts('rival', 1, { daysAgoFrom: 20, daysAgoTo: 19, likes: 'hidden' }),
    // Small: only 4 posts a side, below the minimum sample, with a big format swing.
    ...posts('small', 4, { daysAgoFrom: 58, daysAgoTo: 38, likes: 10 }),
    ...posts('small', 4, { daysAgoFrom: 29, daysAgoTo: 8, format: 'short_video', likes: 50 }),
  ];
  return {
    orgSlug: 'canna',
    isDemoOrg: false,
    now: NOW,
    days: 30,
    profiles: [own, rival, small, fresh, profile('off', { isActive: false })],
    followers,
    posts: allPosts,
    snapshots: [
      {
        accountId: 'rival',
        observedAt: '2026-08-01T06:00:00.000Z',
        biography: 'Old bio',
        website: 'https://a.example',
        dataSource: SOURCE,
      },
      {
        accountId: 'rival',
        observedAt: '2026-10-20T06:00:00.000Z',
        biography: 'New bio',
        website: 'https://b.example',
        dataSource: SOURCE,
      },
      // A first snapshot in the period is not a change.
      {
        accountId: 'small',
        observedAt: '2026-10-20T06:00:00.000Z',
        biography: 'Hello',
        website: null,
        dataSource: SOURCE,
      },
    ],
  };
}

describe('dashboard model', () => {
  const model = buildDashboard(fixture());

  it('counts monitored profiles by role and access type', () => {
    expect(model.tiles).toMatchObject({
      active: 4,
      inactive: 1,
      byRole: { owned: 1, competitor: 3 },
      byAccess: { connected: 1, public: 3 },
    });
    expect(model.source).toBe('live_public');
  });

  it('ranks growth only where two observations a day apart exist', () => {
    // Own +40/day on 20k; Small +1/day on 1k; Rival +20/day on 50k.
    expect(model.topGrowing.map((r) => r.profile.id)).toEqual(['own', 'small', 'rival']);
    const fresh = model.rows.find((r) => r.profile.id === 'fresh')!;
    expect(fresh.growth).toMatchObject({
      status: 'unavailable',
      reason: 'not_enough_observations',
    });
    expect(model.growthMissing.map((r) => r.profile.id)).toEqual(['fresh']);
  });

  it('keeps profiles without post history out of frequency instead of showing zero', () => {
    const fresh = model.rows.find((r) => r.profile.id === 'fresh')!;
    expect(fresh.frequency).toMatchObject({
      status: 'unavailable',
      reason: 'history_start_unknown',
    });
    expect(model.frequencyRanked.at(-1)!.profile.id).toBe('fresh');
  });

  it('ranks engagement only with at least 5 posts and reports hidden likes', () => {
    expect(model.topEngagement.map((r) => r.profile.id)).toEqual(['rival', 'own']);
    expect(model.engagementTooFew.map((r) => r.profile.id).sort()).toEqual(['fresh', 'small']);
    const rival = model.rows.find((r) => r.profile.id === 'rival')!;
    expect(rival.engagement).toMatchObject({ excludedHidden: 1 });
    expect(model.hiddenLikesPosts).toBe(1);
  });

  it('builds a follower trend from observed points only', () => {
    expect(model.trend.series.map((s) => s.profile.id)).toEqual(['own', 'rival', 'small']);
    const own = model.trend.series[0]!;
    expect(own.points[0]!.change).toBe(0);
    expect(own.points.length).toBe(30);
  });

  it('averages weekly posts per profile only over covered weeks', () => {
    expect(model.weekly.platformKey).toBe('instagram');
    expect(model.weekly.buckets).toHaveLength(4);
    for (const bucket of model.weekly.buckets) {
      expect(bucket.groups.owned.profiles).toBe(1);
      expect(bucket.groups.competitor.profiles).toBe(2); // "fresh" has no history yet
    }
  });

  it('summarizes groups with medians and leaves missing values out', () => {
    const instagram = model.groups.find((g) => g.platformKey === 'instagram')!;
    const competitor = instagram.engagement.find((g) => g.key === 'competitor')!;
    expect(competitor).toMatchObject({ profiles: 1, unavailable: 2 });
  });
});

describe('“What changed?” insights', () => {
  const input = fixture();
  const model = buildDashboard(input);
  // Every statement, not only the 8 the dashboard shows.
  const all = generateInsights({
    orgSlug: 'canna',
    source: SOURCE,
    periods: model.periods,
    profiles: model.rows.map((r) => ({
      profile: r.profile,
      current: r.current,
      previous: r.previous,
      snapshots: input.snapshots.filter((s) => s.accountId === r.profile.id),
    })),
    limit: 100,
  });
  const kinds = all.map((i) => `${i.kind}:${i.profileId}`);

  it('shows at most 8 statements on the dashboard, from the full list', () => {
    expect(model.insights).toHaveLength(8);
    expect(model.insights).toEqual(all.slice(0, 8));
  });

  it('produces the expected statements', () => {
    expect(kinds).toEqual(
      expect.arrayContaining([
        'growth_change:own',
        'frequency_change:own',
        'engagement_change:own',
        'format_shift:own',
        'engagement_vs_own:rival',
        'bio_change:rival',
        'website_change:rival',
      ]),
    );
  });

  it('skips statements below the minimum sample of 5 posts per side', () => {
    expect(kinds).not.toContain('engagement_change:small');
    expect(kinds).not.toContain('format_shift:small');
  });

  it('does not report a first profile snapshot as a change', () => {
    expect(kinds).not.toContain('bio_change:small');
  });

  it('never says more growth for a profile with a single observation', () => {
    expect(kinds.some((k) => k.endsWith(':fresh'))).toBe(false);
  });

  it('uses descriptive, never causal, wording', () => {
    for (const insight of all) {
      expect(insight.text).not.toMatch(CAUSAL);
      for (const e of insight.evidence) expect(e.value).not.toMatch(CAUSAL);
    }
  });

  it('carries evidence and a link to the data', () => {
    for (const insight of all) {
      expect(insight.evidence.length).toBeGreaterThan(0);
      if (insight.external) expect(insight.href).toMatch(/^https:\/\//);
      else expect(insight.href).toBe(`/canna/accounts/${insight.profileId}`);
      expect(insight.dataSource).toBe('live_public');
    }
  });

  it('states growth with both dates and observation counts', () => {
    const growth = all.find((i) => i.kind === 'growth_change')!;
    expect(growth.text).toMatch(
      /^CANNA NL gained \d+(\.\d)?% followers between \d+ \w{3} and \d+ \w{3}/,
    );
    expect(growth.evidence[0]!.value).toMatch(/observations/);
    expect(growth.text).toMatch(/In the same period it published 8 posts, 4 Reels among them\./);
  });

  it('describes engagement with sample sizes on both sides', () => {
    const vsOwn = all.find((i) => i.kind === 'engagement_vs_own')!;
    expect(vsOwn.text).toMatch(
      /Hydro Rival’s median public engagement per post at 7 days was higher/,
    );
    expect(vsOwn.text).toMatch(/\d+ and \d+ posts/);
  });

  it('is deterministic', () => {
    expect(buildDashboard(fixture()).insights).toEqual(model.insights);
  });
});

describe('insight rules in isolation', () => {
  const periods = periodsFor(NOW, 30);
  const empty = {
    growth: { status: 'unavailable', reason: 'no_observations', detail: '' },
    frequency: { status: 'unavailable', reason: 'history_start_unknown', detail: '' },
    engagement: {
      status: 'unavailable',
      reason: 'no_posts_at_age',
      detail: '',
      excludedHidden: 0,
      excludedMissing: 0,
    },
    published: [],
    measured: [],
  } as const satisfies ProfileInsightInput['current'];

  it('says nothing without data', () => {
    expect(
      generateInsights({
        orgSlug: 'x',
        source: SOURCE,
        periods,
        profiles: [{ profile: profile('a'), current: empty, previous: empty, snapshots: [] }],
      }),
    ).toEqual([]);
  });

  it('skips the top post statement with fewer than 5 measured posts', () => {
    const few = posts('a', 4, { daysAgoFrom: 30, daysAgoTo: 10, likes: 500 });
    expect(
      generateInsights({
        orgSlug: 'x',
        source: SOURCE,
        periods,
        profiles: [
          {
            profile: profile('a'),
            current: { ...empty, measured: few },
            previous: empty,
            snapshots: [],
          },
        ],
      }).filter((i) => i.kind === 'top_post'),
    ).toEqual([]);
  });

  it('links the top post to its permalink', () => {
    const many = posts('a', 6, { daysAgoFrom: 30, daysAgoTo: 10, likes: 500 });
    const [top] = generateInsights({
      orgSlug: 'x',
      source: SOURCE,
      periods,
      profiles: [
        {
          profile: profile('a'),
          current: { ...empty, measured: many },
          previous: empty,
          snapshots: [],
        },
      ],
    });
    expect(top).toMatchObject({ kind: 'top_post', external: true });
    expect(top!.href).toBe(many.at(-1)!.permalink);
    expect(top!.text).not.toMatch(CAUSAL);
  });
});
