import { comparabilityClass } from '@/lib/metrics/registry';
import { median } from './stats';
import type { BusinessRole, DataSource, MetricAvailability } from './types';

/**
 * The single data source analytics compares on. Real organizations compare every profile,
 * CANNA's own included, on public observations, so connected profiles are measured the same
 * way as competitors. Demo organizations only hold DEMO values.
 */
export function comparisonSource(isDemoOrg: boolean): DataSource {
  return isDemoOrg ? 'demo' : 'live_public';
}

/** Data sources whose posts count as "a post exists" for posting frequency. */
export function postSources(isDemoOrg: boolean): DataSource[] {
  return isDemoOrg ? ['demo'] : ['live_public', 'live_connected'];
}

/** A value with everything needed to decide whether it may be compared with another. */
export type ComparableValue = {
  metricKey: string;
  comparabilityClass: string;
  dataSource: DataSource;
  /** null = unavailable; never replaced by zero. */
  value: number | null;
  availability?: MetricAvailability;
};

export function comparableValue(input: {
  platformKey: string;
  scope: 'account' | 'post';
  metricKey: string;
  sourceMetric?: string;
  dataSource: DataSource;
  value: number | null;
  availability?: MetricAvailability;
}): ComparableValue {
  return {
    metricKey: input.metricKey,
    comparabilityClass: comparabilityClass(
      input.platformKey,
      input.scope,
      input.metricKey,
      input.sourceMetric,
    ),
    dataSource: input.dataSource,
    value: input.value,
    availability: input.availability,
  };
}

export type ComparabilityRefusal =
  'different_metric' | 'different_class' | 'different_source' | 'estimated_source';

export const REFUSAL_LABELS: Record<ComparabilityRefusal, string> = {
  different_metric: 'These are different metrics.',
  different_class:
    'These numbers are measured differently on each platform, so they aren’t compared.',
  different_source:
    'These numbers come from different sources (for example public vs connected), so they aren’t compared.',
  estimated_source: 'Estimated values are never compared with observed ones.',
};

/** Two values may be compared only with the same metric key, comparability class and source. */
export function checkComparable(
  a: ComparableValue,
  b: ComparableValue,
): { ok: true } | { ok: false; reason: ComparabilityRefusal } {
  if (a.metricKey !== b.metricKey) return { ok: false, reason: 'different_metric' };
  if (a.comparabilityClass !== b.comparabilityClass)
    return { ok: false, reason: 'different_class' };
  if (a.dataSource !== b.dataSource) return { ok: false, reason: 'different_source' };
  if (a.dataSource === 'estimated') return { ok: false, reason: 'estimated_source' };
  return { ok: true };
}

export type Comparison =
  | { status: 'compared'; a: number; b: number; difference: number; ratio: number | null }
  | { status: 'refused'; reason: ComparabilityRefusal }
  | { status: 'unavailable'; missing: ('a' | 'b')[] };

/**
 * Compares two values. Refuses incomparable pairs; a value missing on either side makes the
 * comparison unavailable for that side (it is never treated as zero).
 */
export function compareValues(a: ComparableValue, b: ComparableValue): Comparison {
  const check = checkComparable(a, b);
  if (!check.ok) return { status: 'refused', reason: check.reason };
  const missing: ('a' | 'b')[] = [];
  if (a.value === null) missing.push('a');
  if (b.value === null) missing.push('b');
  if (missing.length) return { status: 'unavailable', missing };
  return {
    status: 'compared',
    a: a.value!,
    b: b.value!,
    difference: a.value! - b.value!,
    ratio: b.value === 0 ? null : a.value! / b.value!,
  };
}

export type GroupSummary = {
  key: string;
  /** Median over profiles with a value. null when none has one. */
  median: number | null;
  /** Profiles with a value. */
  profiles: number;
  /** Profiles in the group without a value (shown as such, not as zero). */
  unavailable: number;
};

/**
 * Medians by group (role, country…), so one large profile doesn't dominate. Every value in
 * the input must be comparable with every other; otherwise the summary is refused.
 */
export function summarizeGroups(
  rows: readonly { group: string; value: ComparableValue }[],
): { status: 'ok'; groups: GroupSummary[] } | { status: 'refused'; reason: ComparabilityRefusal } {
  for (const row of rows.slice(1)) {
    const check = checkComparable(rows[0]!.value, row.value);
    if (!check.ok) return { status: 'refused', reason: check.reason };
  }
  const groups = new Map<string, { values: number[]; unavailable: number }>();
  for (const row of rows) {
    const group = groups.get(row.group) ?? { values: [], unavailable: 0 };
    groups.set(row.group, group);
    if (row.value.value === null) group.unavailable++;
    else group.values.push(row.value.value);
  }
  return {
    status: 'ok',
    groups: [...groups.entries()]
      .map(([key, group]) => ({
        key,
        median: median(group.values),
        profiles: group.values.length,
        unavailable: group.unavailable,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/** Own profiles vs everyone CANNA watches for a reason (competitor, industry…). */
export function roleGroup(role: BusinessRole): 'owned' | 'competitor' | 'other' {
  if (role === 'owned') return 'owned';
  if (role === 'competitor') return 'competitor';
  return 'other';
}

export const ROLE_GROUP_LABELS: Record<ReturnType<typeof roleGroup>, string> = {
  owned: 'Own profiles',
  competitor: 'Competitors',
  other: 'Industry, creators and others',
};
