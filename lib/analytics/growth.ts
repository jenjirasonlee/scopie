import { DAY_MS, formatDay, inPeriod } from './range';
import {
  unavailable,
  type DataSource,
  type FollowerObservation,
  type Period,
  type Result,
} from './types';

export type GrowthPoint = { at: string; value: number };

export type Growth = Result<{
  first: GrowthPoint;
  last: GrowthPoint;
  /** last − first */
  change: number;
  /** (last − first) / first; null when the first value is 0. */
  rate: number | null;
  /** Observations with a value inside the period. */
  observations: number;
  dataSource: DataSource;
}>;

/**
 * Observed follower growth: the first and the last follower observation inside the period,
 * never values from outside it and never interpolated. Needs at least two observations at
 * least 24 hours apart; otherwise "not enough observations".
 *
 * Only pass observations of one data source; mixing sources is refused.
 */
export function observedGrowth(
  observations: readonly FollowerObservation[],
  period: Period,
): Growth {
  const points = observations
    .filter((o) => o.value !== null && o.availability === 'available' && inPeriod(o.at, period))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const sources = new Set(points.map((point) => point.dataSource));
  if (sources.size > 1) {
    throw new Error('observedGrowth: observations from more than one data source');
  }
  if (!points.length) {
    return unavailable('no_observations', 'No follower count was observed in this period.');
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (points.length < 2 || Date.parse(last.at) - Date.parse(first.at) < DAY_MS) {
    return unavailable(
      'not_enough_observations',
      `Growth needs two follower observations at least a day apart; this period has ${points.length} since ${formatDay(first.at)}.`,
    );
  }
  const change = last.value! - first.value!;
  return {
    status: 'ok',
    first: { at: first.at, value: first.value! },
    last: { at: last.at, value: last.value! },
    change,
    rate: first.value! > 0 ? change / first.value! : null,
    observations: points.length,
    dataSource: first.dataSource,
  };
}

/** The most recent observed follower count, if any, with its date. */
export function latestFollowers(
  observations: readonly FollowerObservation[],
): { at: string; value: number; dataSource: DataSource } | null {
  let latest: FollowerObservation | null = null;
  for (const o of observations) {
    if (o.value === null || o.availability !== 'available') continue;
    if (!latest || Date.parse(o.at) > Date.parse(latest.at)) latest = o;
  }
  return latest ? { at: latest.at, value: latest.value!, dataSource: latest.dataSource } : null;
}
