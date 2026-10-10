import { describe, expect, it } from 'vitest';
import { buildMarketerView, formatRate, type ObservedPost } from '@/lib/analytics/marketer';
import type { FollowerObservation, Period, ProfileRecord } from '@/lib/analytics/types';

const DAY = 86_400_000;
const NOW = new Date('2026-10-30T12:00:00.000Z');
const period: Period = { start: new Date(NOW.getTime() - 30 * DAY), end: NOW };

const profile = (id: string, extra: Partial<ProfileRecord> = {}): ProfileRecord => ({
  id,
  name: id,
  handle: id,
  platformKey: 'instagram',
  businessRole: 'competitor',
  accessType: 'public',
  countryCode: null,
  isActive: true,
  firstObservedAt: '2026-09-01T06:00:00Z',
  lastObservedAt: NOW.toISOString(),
  earliestPostAt: '2026-08-01T00:00:00Z',
  ...extra,
});

const followers = (value: number): FollowerObservation[] => [
  { at: '2026-10-29T06:00:00Z', value, availability: 'available', dataSource: 'live_public' },
];

let n = 0;
const post = (
  accountId: string,
  daysAgo: number,
  likes: number | null,
  comments: number,
  extra: Partial<ObservedPost> = {},
): ObservedPost => ({
  id: `post-${n++}`,
  accountId,
  publishedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
  mediaFormat: 'image',
  permalink: null,
  caption: null,
  hashtags: [],
  dataSource: 'live_public',
  likes:
    likes === null
      ? { value: null, availability: 'hidden_by_owner', dataSource: 'live_public' }
      : { value: likes, availability: 'available', dataSource: 'live_public' },
  comments: { value: comments, availability: 'available', dataSource: 'live_public' },
  ageHours: daysAgo * 24,
  ...extra,
});

function view(posts: ObservedPost[], profiles?: ProfileRecord[]) {
  return buildMarketerView({
    period,
    timeZone: 'UTC',
    profiles: profiles ?? [profile('us', { businessRole: 'owned' }), profile('rival')],
    followers: new Map([
      ['us', followers(1_000)],
      ['rival', followers(10_000)],
    ]),
    posts,
  });
}

describe('marketer view', () => {
  it('compares engagement as a share of followers, so size alone does not win', () => {
    const result = view([
      post('us', 3, 50, 10),
      post('us', 5, 40, 10),
      post('us', 7, 60, 10),
      post('rival', 3, 200, 0),
      post('rival', 5, 300, 0),
      post('rival', 7, 100, 0),
    ]);
    const [us, rival] = result.profiles;
    expect(us!.own).toBe(true);
    expect(us!.engagementRate).toBeCloseTo(0.06);
    expect(rival!.engagementRate).toBeCloseTo(0.02);
    expect(result.headlines[0]).toContain('6%');
    expect(result.headlines[0]).toContain('landing better than theirs');
  });

  it('leaves out posts younger than two days and hidden likes, never counting them as zero', () => {
    const result = view([
      post('rival', 1, 5_000, 0),
      post('rival', 3, null, 4),
      post('rival', 4, 100, 0),
    ]);
    const rival = result.profiles.find((p) => p.profile.id === 'rival')!;
    expect(rival.measuredPosts).toBe(1);
    expect(rival.hiddenLikes).toBe(1);
    expect(rival.typicalEngagement).toBeNull();
    expect(result.winningPosts.map((w) => w.engagement)).toEqual([100]);
  });

  it("ranks only the watched profiles' posts, with how they compare with their usual post", () => {
    const result = view([
      post('us', 3, 900, 0),
      post('rival', 3, 100, 0),
      post('rival', 4, 100, 0),
      post('rival', 5, 400, 0),
    ]);
    expect(result.winningPosts.map((w) => w.profile.id)).toEqual(['rival', 'rival', 'rival']);
    expect(result.winningPosts[0]!.engagement).toBe(400);
    expect(result.winningPosts[0]!.timesTypical).toBe(4);
  });

  it('shows a format only with enough posts, best first', () => {
    const result = view([
      post('rival', 3, 300, 0, { mediaFormat: 'short_video' }),
      post('rival', 4, 300, 0, { mediaFormat: 'short_video' }),
      post('rival', 5, 300, 0, { mediaFormat: 'short_video' }),
      post('rival', 6, 100, 0),
      post('rival', 8, 100, 0),
      post('rival', 9, 100, 0),
      post('rival', 10, 900, 0, { mediaFormat: 'carousel' }),
    ]);
    expect(result.formats.map((f) => [f.key, f.posts])).toEqual([
      ['short_video', 3],
      ['image', 3],
    ]);
    expect(result.headlines.some((line) => line.includes('3×'))).toBe(true);
  });

  it('compares one platform at a time, preferring one where we sit next to others', () => {
    const profiles = [
      profile('us', { businessRole: 'owned' }),
      profile('rival'),
      profile('yt-1', { platformKey: 'youtube' }),
      profile('yt-2', { platformKey: 'youtube' }),
      profile('yt-3', { platformKey: 'youtube' }),
    ];
    expect(view([], profiles).platformKey).toBe('instagram');
    expect(view([], profiles).profiles.map((p) => p.profile.id)).toEqual(['us', 'rival']);
    const youtube = buildMarketerView({
      period,
      timeZone: 'UTC',
      profiles,
      followers: new Map(),
      posts: [],
      platformKey: 'youtube',
    });
    expect(youtube.profiles).toHaveLength(3);
    expect(youtube.headlines.at(-1)).toContain('Add your own profile');
  });

  it('formats rates readably', () => {
    expect(formatRate(0.0123)).toBe('1.2%');
    expect(formatRate(0.25)).toBe('25%');
  });
});
