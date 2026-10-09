import { observedGrowth } from '@/lib/analytics/growth';
import { postingFrequency } from '@/lib/analytics/frequency';
import type { FollowerObservation, Period, ProfileRecord } from '@/lib/analytics/types';
import type { Enums } from '@/lib/db/types';
import { inStrategyScope, strategyPeriod, type CoverageItem, type StrategyScope } from './coverage';

// KPI progress for strategy objectives, measured only from what Scopie stored: content
// marked published, and posts and follower counts observed on the organization's own
// profiles. When something can't be measured, the result says why instead of showing 0.

export type StrategyKpi = Enums<'strategy_kpi'>;

export type ObjectiveInput = {
  id: string;
  name: string;
  kpi: StrategyKpi;
  targetValue: number | null;
};

export type OwnProfileData = {
  profile: ProfileRecord;
  followers: readonly FollowerObservation[];
  posts: readonly { publishedAt: string }[];
};

export type ProgressTiming =
  | { stage: 'not_started'; startsOn: string }
  | { stage: 'running'; elapsed: number }
  | { stage: 'ended' };

export type ObjectiveProgress =
  | {
      status: 'measured';
      value: number;
      target: number;
      /** value / target, not capped. */
      ratio: number;
      /** For totals: where the value should be by now if spread evenly over the period. */
      expectedByNow: number | null;
      /** Plain sentence on what was counted. */
      basis: string;
      /** Profiles left out because they couldn't be measured, with the reason. */
      leftOut: { name: string; reason: string }[];
    }
  | { status: 'manual'; target: number | null }
  | { status: 'not_started'; startsOn: string; target: number }
  | { status: 'unavailable'; reason: string; target: number };

export function progressTiming(period: Period, now: Date, periodStart: string): ProgressTiming {
  if (now < period.start) return { stage: 'not_started', startsOn: periodStart };
  if (now >= period.end) return { stage: 'ended' };
  const elapsed =
    (now.getTime() - period.start.getTime()) / (period.end.getTime() - period.start.getTime());
  return { stage: 'running', elapsed };
}

/** Own, active profiles in the strategy's markets and platforms. */
export function ownProfilesInScope(
  profiles: readonly OwnProfileData[],
  scope: StrategyScope,
): OwnProfileData[] {
  return profiles.filter(
    ({ profile }) =>
      profile.businessRole === 'owned' &&
      profile.isActive &&
      (!scope.countryCodes.length ||
        (profile.countryCode !== null && scope.countryCodes.includes(profile.countryCode))) &&
      (!scope.platformKeys.length || scope.platformKeys.includes(profile.platformKey)),
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function measureObjective(input: {
  objective: ObjectiveInput;
  scope: StrategyScope;
  timeZone: string;
  now: Date;
  items: readonly CoverageItem[];
  profiles: readonly OwnProfileData[];
}): ObjectiveProgress {
  const { objective, scope } = input;
  if (objective.kpi === 'manual') return { status: 'manual', target: objective.targetValue };
  const target = objective.targetValue ?? 0;
  const period = strategyPeriod(scope, input.timeZone);
  const timing = progressTiming(period, input.now, scope.periodStart);
  if (timing.stage === 'not_started') {
    return { status: 'not_started', startsOn: timing.startsOn, target };
  }
  // Only time that has passed can have been observed.
  const measured: Period = {
    start: period.start,
    end: new Date(Math.min(period.end.getTime(), input.now.getTime())),
  };
  const ratio = (value: number) => (target > 0 ? value / target : value > 0 ? 1 : 0);

  if (objective.kpi === 'published_content') {
    const published = input.items.filter(
      (item) =>
        (item.status === 'PUBLISHED' || item.status === 'ANALYSED') &&
        inStrategyScope(item, scope, period),
    ).length;
    return {
      status: 'measured',
      value: published,
      target,
      ratio: ratio(published),
      expectedByNow: timing.stage === 'running' ? target * timing.elapsed : null,
      basis: `Content marked published in Scopie for this strategy's markets and platforms: ${plural(published, 'item')}.`,
      leftOut: [],
    };
  }

  const profiles = ownProfilesInScope(input.profiles, scope);
  if (!profiles.length) {
    return {
      status: 'unavailable',
      reason: 'None of your own profiles are in this strategy’s markets and platforms.',
      target,
    };
  }
  const leftOut: { name: string; reason: string }[] = [];

  if (objective.kpi === 'posts_per_week') {
    let total = 0;
    let counted = 0;
    for (const { profile, posts } of profiles) {
      const frequency = postingFrequency({
        publishedAt: posts.map((post) => post.publishedAt),
        earliestPostAt: profile.earliestPostAt,
        period: measured,
        observedUntil: profile.lastObservedAt,
        clip: true,
      });
      if (frequency.status === 'ok') {
        total += frequency.postsPerWeek;
        counted += 1;
      } else leftOut.push({ name: profile.name, reason: frequency.detail });
    }
    if (!counted) {
      return {
        status: 'unavailable',
        reason: 'Posting can’t be measured yet for any of the profiles in scope.',
        target,
      };
    }
    const value = Math.round(total * 10) / 10;
    return {
      status: 'measured',
      value,
      target,
      ratio: ratio(value),
      expectedByNow: null,
      basis: `Posts per week observed on ${plural(counted, 'own profile')}, added together.`,
      leftOut,
    };
  }

  // follower_growth
  let total = 0;
  let counted = 0;
  for (const { profile, followers } of profiles) {
    const growth = observedGrowth(followers, measured);
    if (growth.status === 'ok') {
      total += growth.change;
      counted += 1;
    } else leftOut.push({ name: profile.name, reason: growth.detail });
  }
  if (!counted) {
    return {
      status: 'unavailable',
      reason:
        'Follower growth needs two observations a day apart; none of the profiles in scope have them yet.',
      target,
    };
  }
  return {
    status: 'measured',
    value: total,
    target,
    ratio: ratio(total),
    expectedByNow: timing.stage === 'running' ? target * timing.elapsed : null,
    basis: `Followers gained since the start of the period, observed on ${plural(counted, 'own profile')}, added together.`,
    leftOut,
  };
}
