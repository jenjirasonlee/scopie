import { describe, expect, it } from 'vitest';
import type { BenchmarkProfileData } from '@/lib/analytics/benchmark';
import { formatPeriod } from '@/lib/analytics/range';
import type { FollowerObservation, PostRecord, ProfileRecord } from '@/lib/analytics/types';
import { buildWeeklySnapshot, type WeeklyReportInput } from '@/lib/reports/build';
import { reportIsDue } from '@/lib/reports/generate';
import {
  addDays,
  isoWeekday,
  lastFullWeek,
  localHour,
  previousWeek,
  weekPeriod,
} from '@/lib/reports/week';

const TZ = 'Europe/Amsterdam';
// Thursday 8 October 2026, 14:00 in Amsterdam.
const NOW = new Date('2026-10-08T12:00:00Z');

describe('report weeks', () => {
  it('counts days and ISO weekdays', () => {
    expect(addDays('2026-10-04', 1)).toBe('2026-10-05');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(isoWeekday('2026-10-05')).toBe(1);
    expect(isoWeekday('2026-10-04')).toBe(7);
  });

  it('picks the last week that has fully ended, Monday to Sunday', () => {
    expect(lastFullWeek(NOW, TZ)).toEqual({ start: '2026-09-28', end: '2026-10-04' });
    // Sunday evening in Amsterdam: that week isn't over yet.
    expect(lastFullWeek(new Date('2026-10-04T20:00:00Z'), TZ)).toEqual({
      start: '2026-09-21',
      end: '2026-09-27',
    });
    // Just after midnight on Monday in Amsterdam (still Sunday in UTC).
    expect(lastFullWeek(new Date('2026-10-04T22:30:00Z'), TZ)).toEqual({
      start: '2026-09-28',
      end: '2026-10-04',
    });
    expect(previousWeek({ start: '2026-09-28', end: '2026-10-04' })).toEqual({
      start: '2026-09-21',
      end: '2026-09-27',
    });
  });

  it('turns a week into instants in the time zone', () => {
    const period = weekPeriod({ start: '2026-09-28', end: '2026-10-04' }, TZ);
    expect(period.start.toISOString()).toBe('2026-09-27T22:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-10-04T22:00:00.000Z');
    // Labels count the days in the organization's time zone, not UTC.
    expect(formatPeriod(period)).toBe('28 Sept – 4 Oct');
    // The week the clocks go back is 169 hours long.
    const autumn = weekPeriod({ start: '2026-10-19', end: '2026-10-25' }, TZ);
    expect((autumn.end.getTime() - autumn.start.getTime()) / 3_600_000).toBe(169);
  });

  it('is due from Monday 06:00 local time', () => {
    expect(localHour(new Date('2026-10-05T03:30:00Z'), TZ)).toBe(5);
    expect(reportIsDue(new Date('2026-10-05T03:30:00Z'), TZ)).toBe(false);
    expect(reportIsDue(new Date('2026-10-05T04:00:00Z'), TZ)).toBe(true);
    // A missed Monday is caught up later in the week.
    expect(reportIsDue(new Date('2026-10-06T01:00:00Z'), TZ)).toBe(true);
    // Auckland's Monday morning is still Sunday in UTC.
    expect(reportIsDue(new Date('2026-10-04T17:30:00Z'), 'Pacific/Auckland')).toBe(true);
  });
});

const DAY = 86_400_000;
const week = { start: '2026-09-28', end: '2026-10-04' };
const period = weekPeriod(week, TZ);
const previousPeriod = weekPeriod(previousWeek(week), TZ);

const profile = (id: string, over: Partial<ProfileRecord> = {}): ProfileRecord => ({
  id,
  name: `CANNA ${id.toUpperCase()} (DEMO)`,
  handle: id,
  platformKey: 'instagram',
  businessRole: 'owned',
  accessType: 'demo',
  countryCode: id.toUpperCase(),
  isActive: true,
  firstObservedAt: '2026-01-01T00:00:00Z',
  lastObservedAt: NOW.toISOString(),
  earliestPostAt: '2026-01-01T00:00:00Z',
  ...over,
});

const follower = (at: Date, value: number | null): FollowerObservation => ({
  at: at.toISOString(),
  value,
  availability: value === null ? 'pending' : 'available',
  dataSource: 'demo',
});

/** Daily follower counts from the start of the week before, growing by `perDay`. */
function followers(start: number, perDay: number): FollowerObservation[] {
  return Array.from({ length: 14 }, (_, i) =>
    follower(new Date(previousPeriod.start.getTime() + i * DAY + 3_600_000), start + i * perDay),
  );
}

let seq = 0;
function post(accountId: string, at: Date, engagement: number): PostRecord {
  seq += 1;
  return {
    id: `p${seq}`,
    accountId,
    publishedAt: at.toISOString(),
    mediaFormat: 'short_video',
    permalink: `https://example.com/p/${seq}`,
    caption: `Post ${seq}`,
    hashtags: [],
    dataSource: 'demo',
    likes: { value: engagement - 5, availability: 'available', dataSource: 'demo' },
    comments: { value: 5, availability: 'available', dataSource: 'demo' },
  };
}

function input(over: Partial<WeeklyReportInput> = {}): WeeklyReportInput {
  const profiles = [
    profile('nl'),
    profile('de'),
    profile('rival', { businessRole: 'competitor', accessType: 'public' }),
  ];
  const posts = (id: string, base: number) =>
    Array.from({ length: 6 }, (_, i) =>
      post(id, new Date(previousPeriod.start.getTime() + (i + 0.5) * DAY), base + i * 10),
    );
  const data = new Map<string, BenchmarkProfileData>([
    ['nl', { profile: profiles[0]!, followers: followers(1000, 10), posts: posts('nl', 100) }],
    ['de', { profile: profiles[1]!, followers: followers(5000, 30), posts: posts('de', 300) }],
    ['rival', { profile: profiles[2]!, followers: followers(9000, 50), posts: [] }],
  ]);
  return {
    orgName: 'CANNA (DEMO)',
    isDemo: true,
    source: 'demo',
    timeZone: TZ,
    week,
    previousWeek: previousWeek(week),
    period,
    previousPeriod,
    profiles,
    data,
    names: new Map(profiles.map((p) => [p.id, p.name])),
    content: { published: 4, previousPublished: 2, reviews: 3, previousReviews: 0 },
    strategies: [],
    analysis: null,
    ...over,
  };
}

describe('weekly report snapshot', () => {
  it('sums follower growth over own profiles only', () => {
    const snapshot = buildWeeklySnapshot(input());
    const gained = snapshot.kpis.find((k) => k.key === 'followers_gained')!;
    // Six days between the first and last count in the week: 6×10 + 6×30.
    expect(gained.value).toBe(240);
    expect(gained.display).toBe('+240');
    expect(gained.previous).toBe(240);
    expect(snapshot.summary[0]).toContain('+240 followers');
  });

  it('ranks markets and competitors separately', () => {
    const snapshot = buildWeeklySnapshot(input());
    // Ranked by growth rate: NL +60 on 1,000 beats DE +180 on 5,000.
    expect(snapshot.markets[0]!.rows.map((r) => r.name)).toEqual([
      'CANNA NL (DEMO)',
      'CANNA DE (DEMO)',
    ]);
    const watch = snapshot.competitors[0]!.rows;
    expect(watch.map((r) => [r.name, r.role])).toEqual([
      ['CANNA NL (DEMO)', 'own'],
      ['CANNA DE (DEMO)', 'own'],
      ['CANNA RIVAL (DEMO)', 'competitor'],
    ]);
    expect(snapshot.notes).not.toContain(
      'No competitor profiles are tracked, so there is no competitor watch.',
    );
  });

  it('says N/A with a reason instead of zero when growth was not observed', () => {
    const empty = input();
    const data = new Map(empty.data);
    for (const id of ['nl', 'de']) data.set(id, { ...data.get(id)!, followers: [] });
    const snapshot = buildWeeklySnapshot({ ...empty, data });
    const gained = snapshot.kpis.find((k) => k.key === 'followers_gained')!;
    expect(gained.value).toBeNull();
    expect(gained.unavailable).toBeTruthy();
    expect(snapshot.summary[0]).toMatch(/couldn't be measured/);
  });

  it('counts content and reviews made in Scopie', () => {
    const snapshot = buildWeeklySnapshot(input());
    expect(snapshot.kpis.find((k) => k.key === 'content_published')).toMatchObject({
      value: 4,
      previous: 2,
    });
    expect(snapshot.kpis.find((k) => k.key === 'reviews')).toMatchObject({ value: 3 });
  });

  it('notes when there is no analysis, and splits insights when there is', () => {
    expect(buildWeeklySnapshot(input()).notes).toContain(
      'No analysis could be made for this report, so there are no insights or actions.',
    );
    const insight = (id: string, kind: 'format_winner' | 'format_loser' | 'growth_change') => ({
      id,
      kind,
      title: `Insight ${id}`,
      body: 'Body',
      severity: 'info' as const,
    });
    const snapshot = buildWeeklySnapshot(
      input({
        analysis: {
          meta: {
            runId: 'run',
            writer: 'rules',
            model: null,
            createdAt: NOW.toISOString(),
            periodStart: '2026-09-10',
            periodEnd: '2026-10-08',
          },
          insights: [
            insight('1', 'growth_change'),
            insight('2', 'growth_change'),
            insight('3', 'growth_change'),
            insight('4', 'format_winner'),
            insight('5', 'format_loser'),
          ],
          actions: Array.from({ length: 5 }, (_, i) => ({
            id: `a${i}`,
            title: `Action ${i}`,
            recommendation: 'Do it',
            confidence: 'medium' as const,
          })),
        },
      }),
    );
    expect(snapshot.insights.key.map((i) => i.id)).toEqual(['1', '2', '3']);
    expect(snapshot.insights.opportunities.map((i) => i.id)).toEqual(['4']);
    expect(snapshot.insights.risks.map((i) => i.id)).toEqual(['5']);
    expect(snapshot.actions).toHaveLength(3);
  });

  it('is marked as DEMO data for a demo organization', () => {
    const snapshot = buildWeeklySnapshot(input());
    expect(snapshot).toMatchObject({ isDemo: true, dataSource: 'demo', version: 1 });
  });
});
