import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatPeriod,
  ideaFromRecommendation,
  insightKindLabel,
  parseRecommendationTab,
  profileNames,
  readEvidence,
  readExperiment,
  readRejected,
  readSignalPaths,
  recommendationTabHref,
  statusChangeLabel,
  writerSentence,
} from '@/lib/ai/shared';

const A = '0b6f2d4e-8a1c-4f3e-9d2b-1a2b3c4d5e6f';
const B = '1c7f3e5f-9b2d-4a4f-8e3c-2b3c4d5e6f70';
const C = '2d8f4e6f-0c3e-4b5f-9f4d-3c4d5e6f7081';
const names = new Map([
  [A, 'Canna NL (Instagram)'],
  [B, 'Canna DE (Instagram)'],
]);

describe('recommendation tabs', () => {
  it('fall back to open for anything unknown', () => {
    expect(parseRecommendationTab('done')).toBe('done');
    expect(parseRecommendationTab('dismissed')).toBe('dismissed');
    expect(parseRecommendationTab('nope')).toBe('open');
    expect(parseRecommendationTab(undefined)).toBe('open');
  });

  it('link open to the plain page', () => {
    expect(recommendationTabHref('acme', 'open')).toBe('/acme/insights');
    expect(recommendationTabHref('acme', 'accepted')).toBe('/acme/insights?tab=accepted');
  });
});

describe('formatPeriod', () => {
  it('shows the last included day of a half-open period', () => {
    expect(formatPeriod('2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', 'UTC')).toBe(
      '1 – 30 Sept 2026',
    );
    expect(formatPeriod('2026-08-25T00:00:00Z', '2026-09-08T00:00:00Z', 'UTC')).toBe(
      '25 Aug – 7 Sept 2026',
    );
    expect(formatPeriod('2025-12-28T00:00:00Z', '2026-01-04T00:00:00Z', 'UTC')).toBe(
      '28 Dec 2025 – 3 Jan 2026',
    );
    expect(formatPeriod('2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z', 'UTC')).toBe('1 Sept 2026');
  });

  it('uses the organization time zone', () => {
    // Midnight in Amsterdam is 22:00 UTC the day before.
    expect(formatPeriod('2026-08-31T22:00:00Z', '2026-09-30T22:00:00Z', 'Europe/Amsterdam')).toBe(
      '1 – 30 Sept 2026',
    );
  });

  it('returns null for dates it cannot read', () => {
    expect(formatPeriod('', '', 'UTC')).toBeNull();
    expect(formatPeriod('2026-10-01T00:00:00Z', '2026-09-01T00:00:00Z', 'UTC')).toBeNull();
  });
});

describe('profileNames', () => {
  it('names known profiles and counts removed ones', () => {
    expect(profileNames([A, B, A], names)).toEqual([
      'Canna NL (Instagram)',
      'Canna DE (Instagram)',
    ]);
    expect(profileNames([A, C], names)).toEqual(['Canna NL (Instagram)', 'Removed profile']);
    expect(profileNames([C, '3e9f5a7b-1d4f-4c6a-8a5e-4d5e6f708192'], names)).toEqual([
      '2 removed profiles',
    ]);
    expect(profileNames([], names)).toEqual([]);
  });
});

describe('reading stored json', () => {
  it('keeps evidence rows and never invents a sample size', () => {
    const rows = readEvidence([
      {
        id: 's1.e1',
        label: 'Median engagement rate, Reels',
        value: 0.042,
        display: '4.2%',
        n: 12,
        periodStart: '2026-09-01T00:00:00Z',
        periodEnd: '2026-10-01T00:00:00Z',
        method: 'Median of posts',
        accountIds: [A],
      },
      {
        id: 's1.e2',
        label: 'Posts',
        value: 30,
        display: '30 posts',
        periodStart: '2026-09-01T00:00:00Z',
        periodEnd: '2026-10-01T00:00:00Z',
        method: 'Count',
        accountIds: [A, 7],
      },
      { id: 'broken' },
      'nonsense',
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.n).toBe(12);
    expect(rows[1]?.n).toBeUndefined();
    expect(rows[1]?.accountIds).toEqual([A]);
    expect(readEvidence(null)).toEqual([]);
  });

  it('reads an experiment, or null when there is none', () => {
    expect(readExperiment(null)).toBeNull();
    expect(readExperiment({ hypothesis: 'x' })).toBeNull();
    const experiment = readExperiment({
      hypothesis: 'More Reels',
      variant: 'Three Reels a week',
      control: 'One Reel a week',
      accountIds: [A],
      durationDays: 28,
      successMetric: 'Median engagement rate by reach',
    });
    expect(experiment?.durationDays).toBe(28);
    expect(readExperiment({ hypothesis: 'h', variant: 'v', durationDays: 0 })?.durationDays).toBe(
      Number.NaN,
    );
  });

  it('only keeps signal links inside the organization', () => {
    const paths = readSignalPaths([
      { id: 's1', path: '/accounts/abc' },
      { id: 's2', path: null },
      { id: 's3', path: 'https://example.com' },
      { id: 's4', path: '//example.com' },
    ]);
    expect([...paths]).toEqual([['s1', '/accounts/abc']]);
  });

  it('reads what the checks left out', () => {
    expect(
      readRejected([{ what: 'Insight “Reels win”', reason: 'Number 5.1% not in evidence' }, {}]),
    ).toEqual([{ what: 'Insight “Reels win”', reason: 'Number 5.1% not in evidence' }]);
    expect(readRejected('x')).toEqual([]);
  });
});

describe('labels', () => {
  it('describe kinds, durations and status changes in plain words', () => {
    expect(insightKindLabel('format_winner')).toBe('Format doing well');
    expect(insightKindLabel('country_difference')).toBe('Country difference');
    expect(formatDuration(1)).toBe('1 day');
    expect(formatDuration(14)).toBe('14 days');
    expect(formatDuration(Number.NaN)).toBeNull();
    expect(statusChangeLabel('dismissed', 'Sam', '3 Oct 2026, 10:00')).toBe(
      'Dismissed by Sam, 3 Oct 2026, 10:00',
    );
    expect(statusChangeLabel('done', null, '3 Oct 2026, 10:00')).toBe(
      'Marked done, 3 Oct 2026, 10:00',
    );
    expect(statusChangeLabel('open', 'Sam', 'today')).toBeNull();
  });

  it('say who wrote the words without claiming the AI knows anything', () => {
    expect(writerSentence('rules', null)).toContain('No AI model is connected');
    const model = writerSentence('model', 'gpt-test');
    expect(model).toContain('gpt-test');
    expect(model).toContain('checked');
    for (const text of [writerSentence('rules', null), model]) {
      expect(text).not.toMatch(/\bknows?\b|\bcaused?\b/i);
    }
  });
});

describe('ideaFromRecommendation', () => {
  const rec = {
    title: 'Post more Reels in the Netherlands',
    observation: 'Reels had a 1.6× higher median engagement rate than photos.',
    recommendation: 'Swap two photo posts a week for Reels.',
    expectedImpact: 'Higher median engagement rate by reach.',
    experiment: {
      hypothesis: 'Reels are associated with higher engagement.',
      variant: 'Three Reels a week',
      control: 'One Reel a week',
      accountIds: [A, C],
      durationDays: 28,
      successMetric: 'Median engagement rate by reach',
    },
  };

  it('puts the recommendation in the brief and the experiment in the notes', () => {
    const idea = ideaFromRecommendation(rec, names);
    expect(idea.title).toBe(rec.title);
    expect(idea.description).toContain(rec.recommendation);
    expect(idea.description).toContain(rec.observation);
    expect(idea.notes).toContain('“Post more Reels in the Netherlands”');
    expect(idea.notes).toContain('Profiles: Canna NL (Instagram), Removed profile');
    expect(idea.notes).toContain('Run for: 28 days');
  });

  it('leaves out the experiment when there is none', () => {
    const idea = ideaFromRecommendation({ ...rec, experiment: null }, names);
    expect(idea.notes).not.toContain('Suggested experiment');
  });
});
