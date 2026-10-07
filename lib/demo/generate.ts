import type {
  MediaFormat,
  NormalizedAccountMetric,
  NormalizedPost,
  NormalizedPostMetric,
} from '@/lib/platforms/types';

/**
 * DEMO DATA generator. Produces fictional posts and metrics so screens can be built
 * and tested without real accounts. Everything it makes is stored with
 * data_source 'demo', which the database only accepts in demo organizations and the
 * UI always labels DEMO. Output is deterministic for a given seed and day.
 */

export type DemoCapture = {
  capturedAt: string;
  posts: NormalizedPost[];
  metrics: NormalizedPostMetric[];
};

export type DemoAccountData = {
  accountMetrics: NormalizedAccountMetric[];
  accountCapturedAt: string;
  /** Public profiles: one follower observation per day, each with its own capture time. */
  observations: { capturedAt: string; metrics: NormalizedAccountMetric[] }[];
  captures: DemoCapture[];
  earliestPostAt: string | null;
};

/**
 * 'connected' mimics an owner-authorized account (insights such as reach and saves).
 * 'public' mimics a competitor read through Business Discovery: followers, likes (sometimes
 * hidden by the owner), comments and Reel views only. Private metrics are never generated
 * for public profiles, not even as DEMO DATA.
 */
export type DemoMode = 'connected' | 'public';

const DAY = 86_400_000;
/** Snapshots taken at these post ages, like the real sync schedule. */
const DEMO_SNAPSHOT_DAYS = [1, 7, 30];

const FORMATS: Record<string, MediaFormat[]> = {
  instagram: ['image', 'carousel', 'short_video', 'story'],
  facebook: ['image', 'video', 'link', 'text'],
  youtube: ['long_video', 'short_video'],
  tiktok: ['short_video'],
  linkedin: ['image', 'text', 'carousel', 'video'],
  x: ['text', 'image'],
};

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** Daily capture time: 06:00 UTC, like an overnight sync. */
function captureAfter(time: number): number {
  const day = Math.floor(time / DAY) * DAY + 6 * 3_600_000;
  return day > time ? day : day + DAY;
}

export function generateDemoAccount(input: {
  seed: string;
  platformKey: string;
  now: Date;
  days?: number;
  mode?: DemoMode;
}): DemoAccountData {
  const mode = input.mode ?? 'connected';
  const random = mulberry32(hash(input.seed));
  const days = input.days ?? 60;
  const today = Math.floor(input.now.getTime() / DAY) * DAY;
  const between = (min: number, max: number) => Math.round(min + random() * (max - min));

  // Account metrics: one row per day, ending yesterday (today isn't finished).
  let followers = between(2_000, 40_000);
  const accountMetrics: NormalizedAccountMetric[] = [];
  const observations: DemoAccountData['observations'] = [];
  for (let offset = days; offset >= 1; offset--) {
    const date = new Date(today - offset * DAY).toISOString().slice(0, 10);
    const gained = between(0, Math.max(5, followers / 400));
    const lost = between(0, Math.max(2, followers / 1200));
    followers += gained - lost;
    const reach = between(followers * 0.05, followers * 0.4);
    const day = (metricKey: string, value: number): NormalizedAccountMetric => ({
      metricKey,
      sourceMetric: 'demo',
      value,
      availability: 'available',
      period: 'day',
      metricDate: date,
    });
    if (mode === 'public') {
      // Observed at 06:00 each day; the value is the running total at that moment.
      observations.push({
        capturedAt: `${date}T06:00:00.000Z`,
        metrics: [{ ...day('followers', followers), period: 'lifetime' }],
      });
      continue;
    }
    accountMetrics.push(
      { ...day('followers', followers), period: 'lifetime' },
      day('followers_gained', gained),
      day('followers_lost', lost),
      day('reach', reach),
      day('views', between(reach * 1.2, reach * 2.5)),
    );
  }

  // Posts: a few a week, each measured at 1, 7 and 30 days old (when that has passed).
  const formats = FORMATS[input.platformKey] ?? ['image'];
  const captures = new Map<number, DemoCapture>();
  let time = today - days * DAY;
  let number = 0;
  let earliestPostAt: string | null = null;
  // Public profiles: a few owners hide like counts, as on Instagram.
  const hidesLikes = mode === 'public' && random() < 0.25;
  while (true) {
    time += between(1, 4) * DAY + between(7, 19) * 3_600_000 - 12 * 3_600_000;
    if (time >= input.now.getTime() - DAY) break;
    number += 1;
    const format = formats[between(0, formats.length - 1)]!;
    const post: NormalizedPost = {
      externalId: `demo_${input.seed}_${number}`,
      publishedAt: new Date(time).toISOString(),
      permalink: null,
      caption: `DEMO post ${number}. Fictional content for testing, not a real CANNA post.`,
      mediaFormat: format,
      nativeType: 'DEMO',
    };
    earliestPostAt ??= post.publishedAt;
    const finalReach =
      between(followers * 0.08, followers * 0.6) * (format === 'short_video' ? 2 : 1);
    for (const age of DEMO_SNAPSHOT_DAYS) {
      const at = captureAfter(time + age * DAY);
      if (at > input.now.getTime()) break;
      const share = age === 1 ? 0.55 : age === 7 ? 0.9 : 1;
      const reach = Math.round(finalReach * share);
      const likes = Math.round(reach * (0.02 + random() * 0.05));
      const metric = (metricKey: string, value: number): NormalizedPostMetric => ({
        postExternalId: post.externalId,
        metricKey,
        sourceMetric: 'demo',
        value,
        availability: 'available',
        period: 'lifetime',
        metricDate: null,
      });
      const capture = captures.get(at) ?? {
        capturedAt: new Date(at).toISOString(),
        posts: [],
        metrics: [],
      };
      captures.set(at, capture);
      capture.posts.push(post);
      if (mode === 'public') {
        const unavailable = (
          metricKey: string,
          availability: 'hidden_by_owner' | 'not_applicable',
        ): NormalizedPostMetric => ({ ...metric(metricKey, 0), value: null, availability });
        capture.metrics.push(
          hidesLikes ? unavailable('likes', 'hidden_by_owner') : metric('likes', likes),
          metric('comments', Math.round(likes * (0.02 + random() * 0.08))),
          format === 'short_video'
            ? metric('views', Math.round(reach * (1.3 + random())))
            : unavailable('views', 'not_applicable'),
        );
        continue;
      }
      capture.metrics.push(
        metric('reach', reach),
        metric('views', Math.round(reach * (1.3 + random()))),
        metric(input.platformKey === 'facebook' ? 'reactions' : 'likes', likes),
        metric('comments', Math.round(likes * (0.02 + random() * 0.08))),
        metric('shares', Math.round(likes * random() * 0.15)),
        metric('saves', Math.round(likes * random() * 0.2)),
      );
    }
  }

  return {
    accountMetrics,
    accountCapturedAt: new Date(today).toISOString(),
    observations,
    earliestPostAt,
    captures: [...captures.values()].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)),
  };
}
