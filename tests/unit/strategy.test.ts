import { describe, expect, it } from 'vitest';
import { contentItemSchema } from '@/schemas/content';
import {
  deleteStrategySchema,
  idSetSchema,
  objectiveSchema,
  parsePriorities,
  pillarSharesFrom,
  pillarTargetsSchema,
  strategyBasicsSchema,
  strategyPrioritiesSchema,
  strategyStatusSchema,
} from '@/schemas/strategy';
import {
  compareStrategies,
  formatStrategyPeriod,
  formatTarget,
  isStrategyKpi,
  KPI_HELP,
  KPI_LABELS,
  periodLength,
  periodState,
  pillarTargetTotal,
  quarterOf,
  scopeLabel,
  STRATEGY_KPIS,
  STRATEGY_STATUS_LABELS,
  STRATEGY_STATUSES,
  todayIn,
} from '@/lib/strategy/shared';

const PILLAR_A = '0b6f2d4e-8a1c-4f3e-9d2b-1a2b3c4d5e6f';
const PILLAR_B = '1c7f3e5f-9b2d-4a4f-8e3c-2b3c4d5e6f70';

describe('strategy labels', () => {
  it('cover every status and KPI with a plain explanation', () => {
    expect(STRATEGY_STATUSES.map((s) => STRATEGY_STATUS_LABELS[s])).toEqual([
      'Draft',
      'Active',
      'Archived',
    ]);
    for (const kpi of STRATEGY_KPIS) {
      expect(KPI_LABELS[kpi]).toBeTruthy();
      expect(KPI_HELP[kpi]).toMatch(/\.$/);
      expect(KPI_HELP[kpi]).not.toMatch(/—/);
    }
    expect(KPI_HELP.manual).toContain('only the target is shown');
    expect(isStrategyKpi('posts_per_week')).toBe(true);
    expect(isStrategyKpi('likes')).toBe(false);
  });

  it('format targets in words', () => {
    expect(formatTarget('published_content', 12)).toBe('12 pieces of content');
    expect(formatTarget('published_content', 1)).toBe('1 piece of content');
    expect(formatTarget('posts_per_week', 2.5)).toBe('2.5 posts per week');
    expect(formatTarget('follower_growth', 1500)).toBe('+1,500 followers');
    expect(formatTarget('manual', 40)).toBe('40');
    expect(formatTarget('manual', null)).toBe('No target set');
  });

  it('sort active first, then drafts, then archived, newest period first', () => {
    const list = [
      { name: 'Old', status: 'archived' as const, periodStart: '2026-01-01' },
      { name: 'Next', status: 'draft' as const, periodStart: '2027-01-01' },
      { name: 'Now', status: 'active' as const, periodStart: '2026-10-01' },
      { name: 'Earlier', status: 'active' as const, periodStart: '2026-07-01' },
    ];
    expect([...list].sort(compareStrategies).map((s) => s.name)).toEqual([
      'Now',
      'Earlier',
      'Next',
      'Old',
    ]);
  });

  it('name the scope, or "all" when empty', () => {
    const names = (code: string) => ({ NL: 'Netherlands', BE: 'Belgium' })[code] ?? code;
    expect(scopeLabel([], names, 'All markets')).toBe('All markets');
    expect(scopeLabel(['NL', 'BE', 'XX'], names, 'All markets')).toBe('Netherlands, Belgium, XX');
  });

  it('add up pillar targets without float noise', () => {
    expect(
      pillarTargetTotal([{ targetShare: 33.3 }, { targetShare: 33.3 }, { targetShare: 33.4 }]),
    ).toBe(100);
    expect(pillarTargetTotal([])).toBe(0);
  });
});

describe('strategy periods', () => {
  it('find the calendar quarter of a day', () => {
    expect(quarterOf('2026-10-08')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
    expect(quarterOf('2026-01-01')).toEqual({ start: '2026-01-01', end: '2026-03-31' });
    expect(quarterOf('2028-02-29')).toEqual({ start: '2028-01-01', end: '2028-03-31' });
    expect(quarterOf('2026-06-30')).toEqual({ start: '2026-04-01', end: '2026-06-30' });
  });

  it('use the organization time zone for today', () => {
    const now = new Date('2026-12-31T23:30:00Z');
    expect(todayIn('UTC', now)).toBe('2026-12-31');
    expect(todayIn('Europe/Amsterdam', now)).toBe('2027-01-01');
    expect(todayIn('America/New_York', now)).toBe('2026-12-31');
    expect(todayIn('Not/AZone', now)).toBe('2026-12-31');
  });

  it('count days with both ends included and know whether it is running', () => {
    expect(periodLength('2026-10-01', '2026-12-31')).toBe(92);
    expect(periodLength('2026-10-01', '2026-10-01')).toBe(1);
    expect(periodState('2026-10-01', '2026-12-31', '2026-09-30')).toBe('upcoming');
    expect(periodState('2026-10-01', '2026-12-31', '2026-10-01')).toBe('running');
    expect(periodState('2026-10-01', '2026-12-31', '2026-12-31')).toBe('running');
    expect(periodState('2026-10-01', '2026-12-31', '2027-01-01')).toBe('ended');
  });

  it('format a period', () => {
    expect(formatStrategyPeriod('2026-10-01', '2026-12-31')).toBe('1 Oct – 31 Dec 2026');
    expect(formatStrategyPeriod('2026-12-01', '2027-02-28')).toBe('1 Dec 2026 – 28 Feb 2027');
  });
});

describe('strategy basics schema', () => {
  const base = {
    name: '  Autumn NL ',
    summary: '',
    periodStart: '2026-10-01',
    periodEnd: '2026-12-31',
    countryCodes: ['nl', 'NL', 'be'],
    platformKeys: ['instagram', 'instagram'],
  };

  it('trims, upper-cases and removes duplicates', () => {
    const parsed = strategyBasicsSchema.parse(base);
    expect(parsed).toMatchObject({
      name: 'Autumn NL',
      summary: null,
      countryCodes: ['NL', 'BE'],
      platformKeys: ['instagram'],
    });
  });

  it('allows empty markets and platforms (all)', () => {
    expect(
      strategyBasicsSchema.safeParse({ ...base, countryCodes: [], platformKeys: [] }).success,
    ).toBe(true);
  });

  it('needs a name and a valid period of at most two years', () => {
    const errors = (input: object) =>
      strategyBasicsSchema.safeParse(input).error?.issues.map((i) => i.path.join('.'));
    expect(errors({ ...base, name: ' ' })).toEqual(['name']);
    expect(errors({ ...base, periodStart: '' })).toContain('periodStart');
    expect(errors({ ...base, periodEnd: '2026-09-30' })).toEqual(['periodEnd']);
    expect(errors({ ...base, periodEnd: '2028-10-01' })).toBeUndefined();
    expect(errors({ ...base, periodEnd: '2028-10-02' })).toEqual(['periodEnd']);
    expect(errors({ ...base, countryCodes: ['Netherlands'] })).toEqual(['countryCodes.0']);
  });
});

describe('priorities', () => {
  it('take one per line and drop list markers and empty lines', () => {
    expect(parsePriorities('- Grow Reels\n\n2. More grower stories\r\n  * Less text  \n')).toEqual([
      'Grow Reels',
      'More grower stories',
      'Less text',
    ]);
    expect(strategyPrioritiesSchema.parse({}).priorities).toEqual([]);
  });

  it('allow at most 10 of at most 200 characters', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `Priority ${i}`).join('\n');
    expect(strategyPrioritiesSchema.safeParse({ priorities: eleven }).success).toBe(false);
    expect(strategyPrioritiesSchema.safeParse({ priorities: 'x'.repeat(201) }).success).toBe(false);
    expect(strategyPrioritiesSchema.safeParse({ priorities: 'x'.repeat(200) }).success).toBe(true);
  });
});

describe('objective schema', () => {
  it('needs a target unless tracked outside Scopie', () => {
    expect(
      objectiveSchema.safeParse({ name: 'Reach', kpi: 'follower_growth', targetValue: '' }).error
        ?.issues[0]?.path,
    ).toEqual(['targetValue']);
    expect(
      objectiveSchema.parse({ name: 'Brand love', kpi: 'manual', targetValue: '' }),
    ).toMatchObject({ targetValue: null, description: null });
    expect(
      objectiveSchema.parse({ name: 'Weekly', kpi: 'posts_per_week', targetValue: '2,5' })
        .targetValue,
    ).toBe(2.5);
  });

  it('rejects unknown measures and negative or non-numeric targets', () => {
    expect(objectiveSchema.safeParse({ name: 'X', kpi: 'likes', targetValue: '3' }).success).toBe(
      false,
    );
    expect(
      objectiveSchema.safeParse({ name: 'X', kpi: 'published_content', targetValue: '-1' }).success,
    ).toBe(false);
    expect(
      objectiveSchema.safeParse({ name: 'X', kpi: 'published_content', targetValue: 'ten' })
        .success,
    ).toBe(false);
    expect(objectiveSchema.safeParse({ name: '', kpi: 'manual' }).success).toBe(false);
  });
});

describe('pillar targets schema', () => {
  it('reads share fields and keeps only pillars with a target', () => {
    const form = new FormData();
    form.append('share.' + PILLAR_A, '60');
    form.append('share.' + PILLAR_B, '');
    form.append('other', '5');
    const shares = pillarSharesFrom(form.entries());
    expect(shares).toEqual({ [PILLAR_A]: '60', [PILLAR_B]: '' });
    expect(pillarTargetsSchema.parse(shares)).toEqual([{ pillarId: PILLAR_A, targetShare: 60 }]);
  });

  it('accepts commas and percent signs, and at most 100% in total', () => {
    expect(pillarTargetsSchema.parse({ [PILLAR_A]: '33,5%', [PILLAR_B]: '66.5' })).toEqual([
      { pillarId: PILLAR_A, targetShare: 33.5 },
      { pillarId: PILLAR_B, targetShare: 66.5 },
    ]);
    expect(pillarTargetsSchema.safeParse({ [PILLAR_A]: '60', [PILLAR_B]: '41' }).success).toBe(
      false,
    );
    expect(pillarTargetsSchema.safeParse({ [PILLAR_A]: '101' }).success).toBe(false);
    expect(pillarTargetsSchema.safeParse({ [PILLAR_A]: 'lots' }).success).toBe(false);
    expect(pillarTargetsSchema.safeParse({ 'not-a-pillar': '10' }).success).toBe(false);
    expect(pillarTargetsSchema.parse({})).toEqual([]);
  });
});

describe('status, delete and set schemas', () => {
  it('check ids, statuses and the delete confirmation', () => {
    expect(strategyStatusSchema.safeParse({ strategyId: PILLAR_A, status: 'active' }).success).toBe(
      true,
    );
    expect(strategyStatusSchema.safeParse({ strategyId: PILLAR_A, status: 'done' }).success).toBe(
      false,
    );
    expect(deleteStrategySchema.safeParse({ strategyId: PILLAR_A, confirm: 'yes' }).success).toBe(
      true,
    );
    expect(deleteStrategySchema.safeParse({ strategyId: PILLAR_A, confirm: '' }).success).toBe(
      false,
    );
    expect(idSetSchema.parse([PILLAR_A, PILLAR_A, PILLAR_B])).toEqual([PILLAR_A, PILLAR_B]);
    expect(idSetSchema.parse([])).toEqual([]);
    expect(idSetSchema.safeParse(['nope']).success).toBe(false);
  });
});

describe('content form objective', () => {
  it('is optional and maps empty to null', () => {
    const base = { title: 'Reel', status: 'IDEA', platformKeys: [] };
    expect(contentItemSchema.parse(base).strategyObjectiveId).toBeNull();
    expect(
      contentItemSchema.parse({ ...base, strategyObjectiveId: '' }).strategyObjectiveId,
    ).toBeNull();
    expect(
      contentItemSchema.parse({ ...base, strategyObjectiveId: PILLAR_A }).strategyObjectiveId,
    ).toBe(PILLAR_A);
    expect(contentItemSchema.safeParse({ ...base, strategyObjectiveId: 'x' }).success).toBe(false);
  });
});
