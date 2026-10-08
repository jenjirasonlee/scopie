import { describe, expect, it } from 'vitest';
import { periodsFor } from '@/lib/analytics/range';
import type { MediaFormat, PostRecord, ProfileRecord } from '@/lib/analytics/types';
import { analyzeSignals, draftsFromSignals } from '@/lib/ai/analyze';
import { computeConfidence, confidenceBasis } from '@/lib/ai/confidence';
import { modelInput } from '@/lib/ai/model';
import { fakeProvider } from '@/lib/ai/providers/fake';
import { detectSignals, formatSegments, relativePosts, type SignalInput } from '@/lib/ai/signals';
import { checkText, allowedNumbers } from '@/lib/ai/validate';
import type { Signal } from '@/lib/ai/types';

const NOW = new Date('2026-10-08T12:00:00Z');
const periods = periodsFor(NOW, 28);
const DAY = 86_400_000;

const profile = (id: string, over: Partial<ProfileRecord> = {}): ProfileRecord => ({
  id,
  name: `Profile ${id}`,
  handle: id,
  platformKey: 'instagram',
  businessRole: 'owned',
  accessType: 'connected',
  countryCode: 'NL',
  isActive: true,
  firstObservedAt: '2026-01-01T00:00:00Z',
  lastObservedAt: NOW.toISOString(),
  earliestPostAt: '2026-01-01T00:00:00Z',
  ...over,
});

let seq = 0;
const post = (
  accountId: string,
  engagement: number,
  format: MediaFormat,
  daysAgo: number,
  hashtags: string[] = [],
  hidden = false,
): PostRecord => ({
  id: `p${(seq += 1)}`,
  accountId,
  publishedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
  mediaFormat: format,
  permalink: `https://example.com/p/${seq}`,
  caption: 'A caption that must never reach a model',
  hashtags,
  dataSource: 'demo',
  likes: hidden
    ? { value: null, availability: 'hidden_by_owner', dataSource: 'demo' }
    : { value: engagement - 10, availability: 'available', dataSource: 'demo' },
  comments: { value: 10, availability: 'available', dataSource: 'demo' },
});

/** 10 Reels at twice the usual and 20 images at the usual, spread over the window. */
function ownPosts(accountId: string, tags: string[] = []): PostRecord[] {
  return [
    ...Array.from({ length: 10 }, (_, i) => post(accountId, 200, 'short_video', 8 + i * 4, tags)),
    ...Array.from({ length: 20 }, (_, i) => post(accountId, 100, 'image', 8 + i * 2, tags)),
  ];
}

function input(over: Partial<SignalInput> = {}): SignalInput {
  const profiles = [
    profile('a'),
    profile('b'),
    profile('c'),
    profile('small'),
    profile('x', { businessRole: 'competitor', accessType: 'public' }),
  ];
  const posts = new Map<string, PostRecord[]>([
    ['a', ownPosts('a', ['growtips'])],
    ['b', ownPosts('b')],
    ['c', ownPosts('c')],
    // Too few posts to know the profile's usual.
    ['small', [post('small', 900, 'carousel', 10), post('small', 50, 'image', 12)]],
    [
      'x',
      [
        ...Array.from({ length: 6 }, (_, i) => post('x', 300, 'image', 9 + i, ['autumn'])),
        ...Array.from({ length: 10 }, (_, i) => post('x', 100, 'image', 9 + i * 3)),
        // Hidden likes are left out, never read as 0.
        post('x', 0, 'image', 20, ['autumn'], true),
      ],
    ],
  ]);
  return {
    profiles,
    followers: new Map(),
    posts,
    periods,
    names: new Map(profiles.map((p) => [p.id, p.name])),
    strategies: [],
    ...over,
  };
}

describe('relative engagement', () => {
  it("compares each post with its own profile's median and skips profiles with too few posts", () => {
    const window = { start: periods.previous.start, end: new Date(NOW.getTime() - 7 * DAY) };
    const rel = relativePosts(input().profiles, input().posts, window);
    expect(rel.some((p) => p.accountId === 'small')).toBe(false);
    const reels = rel.filter((p) => p.accountId === 'a' && p.format === 'short_video');
    expect(reels.every((p) => p.ratio === 2)).toBe(true);
    // The hidden-likes post isn't there at all.
    expect(rel.filter((p) => p.accountId === 'x')).toHaveLength(16);
  });

  it('needs enough posts in a format and outside it before comparing', () => {
    const window = { start: periods.previous.start, end: NOW };
    const few = relativePosts([profile('a')], new Map([['a', ownPosts('a').slice(0, 14)]]), window);
    expect(formatSegments(few)).toEqual([]);
  });
});

describe('signals', () => {
  const signals = detectSignals(input());
  const byKind = (kind: Signal['kind']) => signals.filter((s) => s.kind === kind);

  it('finds a format that does better than usual across profiles', () => {
    const [winner] = byKind('format_winner');
    expect(winner).toBeDefined();
    expect(winner!.facts.format).toBe('Reel / short video');
    expect(winner!.stats).toEqual({ n: 30, accounts: 3, consistentAccounts: 3, effect: 2 });
    expect(winner!.evidence[0]).toMatchObject({ display: '2.0×', n: 30 });
    expect(byKind('format_loser')).toEqual([]);
  });

  it('finds a competitor topic the organization did not use, but not one it did', () => {
    const topics = byKind('topic_gap');
    expect(topics.map((t) => t.facts.tag)).toEqual(['#autumn']);
    expect(topics[0]!.stats.n).toBe(6);
    const used = detectSignals(
      input({
        posts: new Map([...input().posts, ['b', ownPosts('b', ['autumn'])]]),
      }),
    );
    expect(used.some((s) => s.kind === 'topic_gap')).toBe(false);
  });

  it('numbers signals and their evidence, strongest first', () => {
    expect(signals.map((s) => s.id)).toEqual(signals.map((_, i) => `s${i + 1}`));
    expect(signals[0]!.evidence[0]!.id).toBe('s1.e1');
    const strengths = signals.map((s) => s.strength);
    expect([...strengths].sort((a, b) => b - a)).toEqual(strengths);
  });

  it('finds pillars under their target in a running strategy', () => {
    const coverage = {
      total: 10,
      planned: 8,
      published: 2,
      comparable: true,
      targetTotal: 100,
      rows: [
        {
          pillarId: 'p1',
          name: 'Grow knowledge',
          color: null,
          targetShare: 50,
          planned: 2,
          published: 0,
          total: 2,
          share: 20,
          verdict: 'under' as const,
        },
      ],
    };
    const [gap] = detectSignals(
      input({ posts: new Map(), strategies: [{ id: 'st', name: 'Autumn', coverage }] }),
    );
    expect(gap!.kind).toBe('pillar_gap');
    // (0.5 × 10 − 2) / 0.5 = 6 more items reach 50%.
    expect(gap!.facts.missing).toBe(6);
    const [rec] = draftsFromSignals([gap!]).recommendations;
    expect(rec!.title).toBe('Plan 6 more Grow knowledge items for Autumn');
    expect(rec!.confidence).toBe('medium');
  });

  it('finds nothing in an organization without data', () => {
    expect(detectSignals(input({ profiles: [], posts: new Map(), names: new Map() }))).toEqual([]);
  });
});

describe('confidence', () => {
  it('is computed from sample size, agreement and effect', () => {
    expect(computeConfidence({ n: 30, accounts: 3, consistentAccounts: 3, effect: 2 })).toBe(
      'high',
    );
    expect(computeConfidence({ n: 30, accounts: 3, consistentAccounts: 1, effect: 2 })).toBe('low');
    expect(computeConfidence({ n: 12, accounts: 1, consistentAccounts: 1, effect: 1.3 })).toBe(
      'medium',
    );
    expect(computeConfidence({ n: 1, accounts: 1, consistentAccounts: 1, effect: 5 })).toBe('low');
    expect(confidenceBasis({ n: 30, accounts: 3, consistentAccounts: 3, effect: 2 })).toBe(
      '30 posts across 3 profiles; 3 of 3 profiles point the same way; difference of 2.0×.',
    );
  });
});

describe('rules writer', () => {
  const signals = detectSignals(input());
  const { insights, recommendations } = draftsFromSignals(signals);

  it('writes only numbers from the evidence and no causes', () => {
    for (const insight of insights) {
      const signal = signals.find((s) => s.id === insight.signalIds[0])!;
      const allowed = allowedNumbers([signal]);
      expect(checkText(insight.title, { allowed, maxLength: 160 })).toEqual({ ok: true });
      expect(checkText(insight.body, { allowed, maxLength: 1200 })).toEqual({ ok: true });
    }
    for (const r of recommendations) {
      const signal = signals.find((s) => s.id === r.insightSignalId)!;
      const allowed = allowedNumbers([signal]);
      for (const text of [r.title, r.observation, r.recommendation, r.expectedImpact]) {
        expect(checkText(text, { allowed, maxLength: 1200 })).toEqual({ ok: true });
      }
    }
  });

  it('turns a format winner into an experiment with a computed confidence', () => {
    const rec = recommendations.find((r) => r.title.startsWith('Post more'))!;
    expect(rec.title).toBe('Post more Reel / short video on Instagram');
    expect(rec.confidence).toBe('high');
    expect(rec.experiment).toMatchObject({ durationDays: 28, accountIds: ['a', 'b', 'c'] });
  });
});

describe('checks on model text', () => {
  const allowed = [2, 30, 0.33, 1.5];
  it('accepts evidence numbers, rounded or as a percentage', () => {
    expect(checkText('Reels got 2.0× the usual (30 posts).', { allowed, maxLength: 200 }).ok).toBe(
      true,
    );
    expect(checkText('They were 33% of posts.', { allowed, maxLength: 200 }).ok).toBe(true);
  });
  it('rejects invented numbers, causes and long text', () => {
    expect(checkText('Reels got 3× the usual.', { allowed, maxLength: 200 })).toMatchObject({
      ok: false,
    });
    expect(checkText('Reels grew reach because of the hook.', { allowed, maxLength: 200 })).toEqual(
      { ok: false, reason: 'claims a cause ("because")' },
    );
    expect(checkText('This will increase sales.', { allowed, maxLength: 200 }).ok).toBe(false);
    expect(checkText('x'.repeat(201), { allowed, maxLength: 200 }).ok).toBe(false);
  });
});

describe('model writer', () => {
  const signals = detectSignals(input());
  const winner = signals.find((s) => s.kind === 'format_winner')!;
  const topic = signals.find((s) => s.kind === 'topic_gap')!;

  it('sends no captions, links or profile ids to the model', () => {
    const { insights, recommendations } = draftsFromSignals(signals);
    const sent = JSON.stringify(modelInput(signals, insights, recommendations));
    expect(sent).not.toContain('caption that must never');
    expect(sent).not.toContain('https://');
    expect(sent).not.toMatch(/"accountIds"|ownAccountIds|"a","b","c"/);
  });

  it('keeps checked rewrites, falls back to Scopie text for the rest, and never raises confidence', async () => {
    const provider = fakeProvider(() => ({
      insights: [
        {
          signalId: winner.id,
          title: 'Reels are working on Instagram',
          body: 'Your Reels got 2.0× the usual engagement over 30 posts.',
          severity: 'important',
        },
        {
          signalId: topic.id,
          title: '#autumn is hot',
          body: 'Posts with #autumn got 5× more engagement because of the season.',
          severity: 'info',
        },
        { signalId: 's999', title: 'Made up', body: 'Nothing.', severity: 'info' },
      ],
      recommendations: [
        {
          signalId: winner.id,
          title: 'Make more Reels',
          observation: 'Reels got 2.0× the usual.',
          recommendation: 'Make half of your Instagram posts Reels for 4 weeks.',
          expectedImpact: 'More posts near 2.0× the usual engagement, if the pattern holds.',
          lowerConfidence: true,
        },
      ],
    }));
    const result = await analyzeSignals({ signals, model: { provider, name: 'test-model' } });

    const first = result.insights[0]!;
    expect(first.title).toBe('Reels are working on Instagram');
    // The model can't make an insight more important than Scopie rated it.
    expect(first.severity).toBe(winner.severity);
    const second = result.insights[1]!;
    expect(second.signalIds).toEqual([topic.id]);
    expect(second.body).toContain('Competitor posts with #autumn');
    expect(result.insights.some((i) => i.title === 'Made up')).toBe(false);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      expect.stringMatching(/number that isn't in the evidence|claims a cause/),
      'cites no known signal',
    ]);

    const rec = result.recommendations.find((r) => r.insightSignalId === winner.id)!;
    expect(rec.title).toBe('Make more Reels');
    expect(rec.confidence).toBe('medium');
    expect(result.generation?.error).toBeNull();
    expect(provider.requests[0]!.user).not.toContain('caption');
  });

  it('keeps Scopie text when the model call fails', async () => {
    const provider = fakeProvider(() => {
      throw new Error('OpenAI returned 500: down');
    });
    const result = await analyzeSignals({ signals, model: { provider, name: 'test-model' } });
    expect(result.insights).toEqual(draftsFromSignals(signals).insights.slice(0, 10));
    expect(result.generation?.error).toBe('OpenAI returned 500: down');
    expect(result.rejected).toEqual([
      { what: 'The whole answer', reason: 'OpenAI returned 500: down' },
    ]);
  });

  it('does not call a model when there is nothing to say', async () => {
    const provider = fakeProvider(() => ({ insights: [], recommendations: [] }));
    const result = await analyzeSignals({ signals: [], model: { provider, name: 'm' } });
    expect(provider.requests).toHaveLength(0);
    expect(result).toEqual({ insights: [], recommendations: [], rejected: [], generation: null });
  });
});
