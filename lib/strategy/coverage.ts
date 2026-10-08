import { zonedDateTimeToUtc } from '@/lib/calendar/time';
import type { Period } from '@/lib/analytics/types';
import type { ContentStatus } from '@/lib/content/shared';

// Strategy coverage: how the content planned and published in a strategy's scope splits
// across its pillars, next to the target share of each. Counted only from content items in
// Scopie; nothing is estimated.

export type StrategyScope = {
  periodStart: string; // YYYY-MM-DD, in the organization's time zone
  periodEnd: string; // inclusive
  countryCodes: readonly string[]; // empty: every market
  platformKeys: readonly string[]; // empty: every platform
};

export type CoverageItem = {
  id: string;
  status: ContentStatus;
  pillarId: string | null;
  countryCode: string | null;
  platformKeys: readonly string[];
  plannedPublishAt: string | null;
  publishedAt: string | null;
};

export type PillarTarget = {
  pillarId: string;
  name: string;
  color: string | null;
  targetShare: number;
};

/** Below this many items, shares swing too much to compare with targets. */
export const MIN_ITEMS_FOR_SHARES = 5;
/** Shares within this many percentage points of the target count as on target. */
export const ON_TARGET_POINTS = 5;

const PUBLISHED: ReadonlySet<ContentStatus> = new Set(['PUBLISHED', 'ANALYSED']);
const LEFT_OUT: ReadonlySet<ContentStatus> = new Set(['ARCHIVED', 'REJECTED']);

/** The strategy period as instants: from the first day's midnight to the day after the last. */
export function strategyPeriod(scope: StrategyScope, timeZone: string): Period {
  const endDay = new Date(Date.parse(`${scope.periodEnd}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    start: zonedDateTimeToUtc(scope.periodStart, '00:00', timeZone),
    end: zonedDateTimeToUtc(endDay, '00:00', timeZone),
  };
}

/**
 * Whether content counts toward a strategy: not archived or rejected, dated (published, or
 * else planned) inside the period, for one of its markets (content for all countries counts
 * everywhere) and on one of its platforms.
 */
export function inStrategyScope(item: CoverageItem, scope: StrategyScope, period: Period): boolean {
  if (LEFT_OUT.has(item.status)) return false;
  const at = item.publishedAt ?? item.plannedPublishAt;
  if (!at) return false;
  const time = Date.parse(at);
  if (time < period.start.getTime() || time >= period.end.getTime()) return false;
  if (
    scope.countryCodes.length &&
    item.countryCode &&
    !scope.countryCodes.includes(item.countryCode)
  )
    return false;
  if (
    scope.platformKeys.length &&
    !item.platformKeys.some((platform) => scope.platformKeys.includes(platform))
  )
    return false;
  return true;
}

export type CoverageVerdict = 'under' | 'on_target' | 'over' | 'no_target';

export type CoverageRow = {
  pillarId: string | null;
  name: string;
  color: string | null;
  targetShare: number | null;
  planned: number;
  published: number;
  total: number;
  /** Percentage of all content in scope; null when there is none. */
  share: number | null;
  /** null when there is too little content to compare. */
  verdict: CoverageVerdict | null;
};

export type Coverage = {
  total: number;
  planned: number;
  published: number;
  rows: CoverageRow[];
  /** False when there are fewer than MIN_ITEMS_FOR_SHARES items; verdicts are then null. */
  comparable: boolean;
  /** Sum of pillar targets, to show when it falls short of 100%. */
  targetTotal: number;
};

export function verdictFor(share: number, target: number | null): CoverageVerdict {
  if (target === null) return 'no_target';
  if (share < target - ON_TARGET_POINTS) return 'under';
  if (share > target + ON_TARGET_POINTS) return 'over';
  return 'on_target';
}

export function computeCoverage(input: {
  items: readonly CoverageItem[];
  scope: StrategyScope;
  pillars: readonly PillarTarget[];
  /** Names of every pillar in the organization, for content on pillars without a target. */
  pillarNames: ReadonlyMap<string, { name: string; color: string | null }>;
  timeZone: string;
}): Coverage {
  const period = strategyPeriod(input.scope, input.timeZone);
  const counted = input.items.filter((item) => inStrategyScope(item, input.scope, period));
  const comparable = counted.length >= MIN_ITEMS_FOR_SHARES;

  const tally = new Map<string | null, { planned: number; published: number }>();
  for (const item of counted) {
    const entry = tally.get(item.pillarId) ?? { planned: 0, published: 0 };
    if (PUBLISHED.has(item.status)) entry.published += 1;
    else entry.planned += 1;
    tally.set(item.pillarId, entry);
  }

  const row = (
    pillarId: string | null,
    name: string,
    color: string | null,
    targetShare: number | null,
  ): CoverageRow => {
    const { planned, published } = tally.get(pillarId) ?? { planned: 0, published: 0 };
    const total = planned + published;
    const share = counted.length ? (total / counted.length) * 100 : null;
    return {
      pillarId,
      name,
      color,
      targetShare,
      planned,
      published,
      total,
      share,
      verdict: comparable && share !== null ? verdictFor(share, targetShare) : null,
    };
  };

  const targeted = new Set(input.pillars.map((p) => p.pillarId));
  const rows = [
    ...input.pillars.map((p) => row(p.pillarId, p.name, p.color, p.targetShare)),
    ...[...tally.keys()]
      .filter((id): id is string => id !== null && !targeted.has(id))
      .map((id) => {
        const pillar = input.pillarNames.get(id);
        return row(id, pillar?.name ?? 'Other pillar', pillar?.color ?? null, null);
      })
      .sort((a, b) => b.total - a.total),
    ...(tally.has(null) ? [row(null, 'No pillar', null, null)] : []),
  ];

  return {
    total: counted.length,
    planned: counted.filter((item) => !PUBLISHED.has(item.status)).length,
    published: counted.filter((item) => PUBLISHED.has(item.status)).length,
    rows,
    comparable,
    targetTotal: input.pillars.reduce((sum, p) => sum + p.targetShare, 0),
  };
}
