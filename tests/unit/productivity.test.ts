import { describe, expect, it } from 'vitest';
import type { PostRecord } from '@/lib/analytics/types';
import type { TeamProductivity, YourImpact } from '@/lib/productivity/queries';
import {
  changeLine,
  formatHours,
  impactSummary,
  mondayOf,
  parsePeriodKey,
  parseView,
  postVersusUsual,
  productivityHref,
  productivityPeriod,
  publishingConsistency,
  rangeInstants,
  reviewStats,
  timeSavedSentence,
  withinRecords,
  type ImpactCounts,
  type ReviewRecord,
} from '@/lib/productivity/shared';
import { impactCounts, impactTiles, teamTiles } from '@/lib/productivity/tiles';

describe('views and periods', () => {
  it('defaults to the team view and this quarter', () => {
    expect(parseView(undefined)).toBe('team');
    expect(parseView('you')).toBe('you');
    expect(parseView('someone-else')).toBe('team');
    expect(parsePeriodKey(['last_quarter'])).toBe('last_quarter');
    expect(parsePeriodKey('year')).toBe('this_quarter');
  });

  it('builds links that keep the other choice', () => {
    expect(productivityHref('acme', 'team', 'this_quarter')).toBe('/acme/productivity');
    expect(productivityHref('acme', 'you', 'last_90_days')).toBe(
      '/acme/productivity?view=you&period=last_90_days',
    );
  });

  it('counts this quarter to today and compares with the same days of last quarter', () => {
    const p = productivityPeriod('this_quarter', '2026-10-09');
    expect(p.range).toEqual({ start: '2026-10-01', end: '2026-10-09' });
    expect(p.full).toEqual({ start: '2026-10-01', end: '2026-12-31' });
    expect(p.comparison).toEqual({ start: '2026-07-01', end: '2026-07-09' });
    expect(p.comparisonLabel).toBe('the first 9 days of last quarter');
  });

  it('never runs the comparison past the end of a shorter quarter', () => {
    // 92 days into Q3 (Jul–Sep) vs Q2, which has 91 days.
    const p = productivityPeriod('this_quarter', '2026-09-30');
    expect(p.comparison).toEqual({ start: '2026-04-01', end: '2026-06-30' });
  });

  it('uses whole quarters for last quarter, across years', () => {
    const p = productivityPeriod('last_quarter', '2026-01-15');
    expect(p.range).toEqual({ start: '2025-10-01', end: '2025-12-31' });
    expect(p.comparison).toEqual({ start: '2025-07-01', end: '2025-09-30' });
  });

  it('uses 90 days including today, against the 90 before', () => {
    const p = productivityPeriod('last_90_days', '2026-10-09');
    expect(p.range).toEqual({ start: '2026-07-12', end: '2026-10-09' });
    expect(p.comparison).toEqual({ start: '2026-04-13', end: '2026-07-11' });
  });

  it('drops a comparison from before the organization had records', () => {
    const p = productivityPeriod('this_quarter', '2026-10-09');
    expect(withinRecords(p, '2026-01-01')).toBe(p);
    const dropped = withinRecords(p, '2026-10-08');
    expect(dropped.comparison).toBeNull();
    expect(dropped.comparisonLabel).toBeNull();
    expect(dropped.noComparison).toBe(
      'No comparison: Scopie has no records for this organization before 8 Oct 2026.',
    );
  });

  it('turns days into instants in the organization time zone', () => {
    const w = rangeInstants({ start: '2026-10-01', end: '2026-10-09' }, 'Europe/Amsterdam');
    expect(w.start.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-10-09T22:00:00.000Z');
  });
});

const window = {
  start: new Date('2026-10-01T00:00:00Z'),
  end: new Date('2026-11-01T00:00:00Z'),
};

function review(
  id: string,
  itemId: string,
  decision: ReviewRecord['decision'],
  decidedAt: string,
  submittedAt: string | null,
): ReviewRecord {
  return { id, itemId, decision, decidedAt, submittedAt };
}

describe('reviewStats', () => {
  it('counts rounds behind each approval, including rounds before the period', () => {
    const stats = reviewStats(
      [
        // Item A: changes asked in September, approved in October: 2 rounds.
        review('1', 'A', 'CHANGES_REQUESTED', '2026-09-28T10:00:00Z', '2026-09-28T08:00:00Z'),
        review('2', 'A', 'APPROVED', '2026-10-02T10:00:00Z', '2026-10-02T09:00:00Z'),
        // Item B: approved first time.
        review('3', 'B', 'APPROVED', '2026-10-05T12:00:00Z', '2026-10-05T00:00:00Z'),
        // Item C: rejected, no approval.
        review('4', 'C', 'REJECTED', '2026-10-06T12:00:00Z', '2026-10-06T06:00:00Z'),
      ],
      window,
    );
    expect(stats.decisions).toBe(3);
    expect(stats.approved).toBe(2);
    expect(stats.rejected).toBe(1);
    expect(stats.roundsPerApproval).toBe(1.5);
    expect(stats.firstTimeShare).toBe(0.5);
    // Hours in review for decisions in the period: 1, 12, 6 → median 6.
    expect(stats.medianHoursInReview).toBe(6);
    expect(stats.timedDecisions).toBe(3);
  });

  it('starts counting rounds again after an earlier approval', () => {
    const stats = reviewStats(
      [
        review('1', 'A', 'APPROVED', '2026-09-01T00:00:00Z', null),
        review('2', 'A', 'APPROVED', '2026-10-10T00:00:00Z', null),
      ],
      window,
    );
    expect(stats.roundsPerApproval).toBe(1);
    expect(stats.firstTimeShare).toBe(1);
    expect(stats.medianHoursInReview).toBeNull();
    expect(stats.timedDecisions).toBe(0);
  });

  it('is unmeasurable, not zero, without approvals or decisions', () => {
    const stats = reviewStats([], window);
    expect(stats.approved).toBe(0);
    expect(stats.roundsPerApproval).toBeNull();
    expect(stats.firstTimeShare).toBeNull();
    expect(stats.medianHoursInReview).toBeNull();
  });

  it('counts a decision once even when loaded twice', () => {
    const r = review('1', 'A', 'APPROVED', '2026-10-02T00:00:00Z', null);
    expect(reviewStats([r, { ...r }], window).approved).toBe(1);
  });
});

describe('formatHours', () => {
  it('reads in minutes, hours or days', () => {
    expect(formatHours(0.25)).toBe('15 min');
    expect(formatHours(1)).toBe('1 hour');
    expect(formatHours(5.25)).toBe('5.3 hours');
    expect(formatHours(72)).toBe('3 days');
  });
});

describe('publishingConsistency', () => {
  it('counts calendar weeks, part weeks included, and items per 7 days', () => {
    expect(mondayOf('2026-10-01')).toBe('2026-09-28');
    expect(mondayOf('2026-10-05')).toBe('2026-10-05');
    const result = publishingConsistency(
      ['2026-10-01', '2026-10-02', '2026-10-13', '2026-09-30', '2026-10-20'],
      { start: '2026-10-01', end: '2026-10-14' },
    );
    // Weeks starting 28 Sep, 5 Oct, 12 Oct; published in the first and third.
    expect(result.weeks).toBe(3);
    expect(result.weeksWithPublished).toBe(2);
    expect(result.published).toBe(3);
    expect(result.perWeek).toBe(1.5);
  });

  it('is a genuine zero when nothing was published', () => {
    const result = publishingConsistency([], { start: '2026-10-01', end: '2026-10-07' });
    expect(result).toEqual({ weeks: 2, weeksWithPublished: 0, published: 0, perWeek: 0 });
  });
});

describe('time saved', () => {
  it('is stated as an estimate with its assumption', () => {
    const text = timeSavedSentence(3);
    expect(text).toMatch(/^Estimate, not measured/);
    expect(text).toContain('about 2 hours');
    expect(text).toContain('about 6 hours');
  });
});

describe('changeLine', () => {
  const tile = { key: 'k', label: 'L', value: 3, display: '3', basis: 'b' };
  it('names the comparison period', () => {
    expect(changeLine({ ...tile, previous: 1, previousDisplay: '1' }, 'the quarter before')).toBe(
      'The quarter before: 1',
    );
  });
  it('says when the comparison is not measurable', () => {
    expect(changeLine({ ...tile, previous: null }, 'the quarter before')).toMatch(/^No comparison/);
  });
  it('is silent without a comparison', () => {
    expect(changeLine(tile, 'the quarter before')).toBeNull();
    expect(changeLine({ ...tile, previous: 1, previousDisplay: '1' }, null)).toBeNull();
  });
});

function post(id: string, likes: number | null, publishedAt = '2026-10-03T00:00:00Z'): PostRecord {
  return {
    id,
    accountId: 'acc',
    publishedAt,
    mediaFormat: 'image',
    permalink: null,
    caption: null,
    hashtags: [],
    dataSource: 'live_public',
    likes:
      likes === null
        ? undefined
        : { value: likes, availability: 'available', dataSource: 'live_public' },
    comments: { value: 0, availability: 'available', dataSource: 'live_public' },
  };
}

describe('postVersusUsual', () => {
  const others = [post('a', 10), post('b', 20), post('c', 30), post('d', 40), post('e', 50)];

  it('compares with the median of the profile’s other posts in the period', () => {
    const result = postVersusUsual(post('mine', 45), [post('mine', 45), ...others], window);
    expect(result).toEqual({ status: 'compared', value: 45, usual: 30, sample: 5, above: true });
  });

  it('leaves out posts outside the period and needs enough of them', () => {
    const result = postVersusUsual(
      post('mine', 45),
      [...others.slice(0, 4), post('old', 1, '2026-09-01T00:00:00Z')],
      window,
    );
    expect(result.status).toBe('not_compared');
  });

  it('says so when the post has no measurement', () => {
    const result = postVersusUsual(post('mine', null), others, window);
    expect(result).toEqual({
      status: 'not_compared',
      reason: 'No likes and comments recorded at 7 days old yet.',
    });
  });
});

const zeroCounts: ImpactCounts = {
  recommendationsActedOn: 0,
  ideasFromRecommendations: 0,
  created: 0,
  published: 0,
  campaigns: 0,
  markets: 0,
  reviews: 0,
  approvedByYou: 0,
  reportsByHand: 0,
  postsCompared: null,
  postsAboveUsual: 0,
};

describe('impactSummary', () => {
  it('builds plain sentences from counts, each with evidence', () => {
    const sentences = impactSummary(
      {
        ...zeroCounts,
        created: 4,
        published: 1,
        campaigns: 2,
        markets: 1,
        recommendationsActedOn: 1,
        reviews: 3,
        approvedByYou: 2,
        reportsByHand: 1,
      },
      'this quarter so far',
    );
    expect(sentences.length).toBeGreaterThanOrEqual(3);
    expect(sentences.length).toBeLessThanOrEqual(5);
    expect(sentences[0]).toEqual({
      text: 'You created 4 content items and marked 1 item as published this quarter so far.',
      href: '#your-content',
    });
    expect(sentences.map((s) => s.href)).toContain('#reviews');
    for (const s of sentences) expect(s.href).toMatch(/^#/);
    // No scores or rankings.
    expect(sentences.map((s) => s.text).join(' ')).not.toMatch(/score|rank|top|colleague/i);
  });

  it('says plainly when nothing was recorded', () => {
    const sentences = impactSummary(zeroCounts, 'last quarter');
    expect(sentences).toHaveLength(1);
    expect(sentences[0]!.text).toMatch(/hasn’t recorded/);
  });

  it('mentions post results only when posts were compared', () => {
    const texts = (c: ImpactCounts) =>
      impactSummary(c, 'x')
        .map((s) => s.text)
        .join(' ');
    expect(texts({ ...zeroCounts, created: 1 })).not.toMatch(/engagement/);
    expect(texts({ ...zeroCounts, postsCompared: 2, postsAboveUsual: 1 })).toMatch(
      /1 of 2 linked posts/,
    );
  });
});

const emptyStats = reviewStats([], window);

const team: TeamProductivity = {
  created: { current: 5, previous: 2 },
  sentForReview: { current: 3, previous: 0 },
  published: { current: 0, previous: null },
  reviews: { current: emptyStats, previous: emptyStats },
  consistency: {
    current: { weeks: 2, weeksWithPublished: 0, published: 0, perWeek: 0 },
    previous: null,
  },
  strategies: [],
  reports: { current: { automatic: 1, byHand: 2 }, previous: { automatic: 0, byHand: 0 } },
  analyses: { current: 1, previous: 0 },
};

describe('teamTiles', () => {
  const tiles = teamTiles(team, 'acme');

  it('shows N/A with a reason when unmeasurable, and 0 for genuine zeros', () => {
    const rounds = tiles.review.find((t) => t.key === 'rounds')!;
    expect(rounds.value).toBeNull();
    expect(rounds.unavailable).toBe('No content was approved in this period.');
    const approved = tiles.output.find((t) => t.key === 'approved')!;
    expect(approved.value).toBe(0);
    expect(approved.display).toBe('0');
  });

  it('gives every tile a basis', () => {
    for (const tile of [
      ...tiles.output,
      ...tiles.review,
      ...tiles.consistency,
      ...tiles.automation,
    ])
      expect(tile.basis.length).toBeGreaterThan(10);
  });

  it('keeps the comparison only where it was measured', () => {
    const published = tiles.output.find((t) => t.key === 'published')!;
    expect(published.previous).toBeNull();
    const created = tiles.output.find((t) => t.key === 'created')!;
    expect(created.previousDisplay).toBe('2');
  });
});

describe('impact tiles and counts', () => {
  const impact: YourImpact = {
    created: { current: 2, previous: 1 },
    createdItems: [],
    published: { current: 1, previous: 0 },
    publishedItems: [],
    recommendations: { current: 1, previous: 0 },
    recommendationItems: [],
    ideasFromRecommendations: { current: 1, previous: 0 },
    ideaItems: [],
    campaigns: [{ id: 'c', name: 'Autumn', items: 2 }],
    markets: [],
    reviews: { current: 2, previous: 0 },
    reviewItems: [
      { id: 'i', title: 't', status: 'APPROVED', at: '', decision: 'APPROVED' },
      { id: 'j', title: 'u', status: 'REJECTED', at: '', decision: 'REJECTED' },
    ],
    reportsByHand: { current: 0, previous: 0 },
    reportItems: [],
    analyses: { current: 0, previous: 0 },
    linkedPosts: 1,
    performance: [
      {
        itemId: 'i',
        title: 't',
        profileName: 'Brand NL',
        platformKey: 'instagram',
        permalink: null,
        result: { status: 'compared', value: 10, usual: 5, sample: 5, above: true },
      },
    ],
  };

  it('counts from the records', () => {
    expect(impactCounts(impact)).toMatchObject({
      created: 2,
      campaigns: 1,
      markets: 0,
      approvedByYou: 1,
      postsCompared: 1,
      postsAboveUsual: 1,
    });
  });

  it('links every tile to its evidence on the page', () => {
    for (const tile of impactTiles(impact)) expect(tile.href).toMatch(/^#/);
  });
});
