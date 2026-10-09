import type { Period } from './types';

export const DAY_MS = 86_400_000;
export const RANGE_OPTIONS = [7, 30, 90] as const;
export type RangeDays = (typeof RANGE_OPTIONS)[number];
export const DEFAULT_RANGE: RangeDays = 30;

/** Reads `?range=7|30|90`; anything else falls back to 30 days. */
export function parseRangeParam(value: string | string[] | undefined): RangeDays {
  const raw = Array.isArray(value) ? value[0] : value;
  const days = Number(raw);
  return (RANGE_OPTIONS as readonly number[]).includes(days) ? (days as RangeDays) : DEFAULT_RANGE;
}

/**
 * The last `days` calendar days (UTC) up to `now`, today included, and the same number of
 * whole days immediately before. Periods start at midnight so date labels don't overlap.
 */
export function periodsFor(now: Date, days: number): { current: Period; previous: Period } {
  const end = now.getTime();
  const start = Math.floor(end / DAY_MS) * DAY_MS - (days - 1) * DAY_MS;
  return {
    current: { start: new Date(start), end: new Date(end) },
    previous: { start: new Date(start - days * DAY_MS), end: new Date(start) },
  };
}

export function inPeriod(at: string | Date, period: Period): boolean {
  const time = typeof at === 'string' ? Date.parse(at) : at.getTime();
  return time >= period.start.getTime() && time < period.end.getTime();
}

/** Posts measured at `ageDays` during a period are the ones published `ageDays` earlier. */
export function shiftPeriod(period: Period, days: number): Period {
  return {
    ...period,
    start: new Date(period.start.getTime() - days * DAY_MS),
    end: new Date(period.end.getTime() - days * DAY_MS),
  };
}

/**
 * When a daily value was observed. A live observation is dated the day it was read, so its
 * capture time is used; a value whose capture time falls on another day (e.g. a daily
 * series written in one batch) is placed at the start of its metric date.
 */
export function observationTime(metricDate: string, capturedAt: string | null): string {
  if (capturedAt && capturedAt.slice(0, 10) === metricDate)
    return new Date(capturedAt).toISOString();
  return new Date(`${metricDate}T00:00:00.000Z`).toISOString();
}

const DAY_FORMATS = new Map<string, Intl.DateTimeFormat>();

function dayFormat(timeZone: string): Intl.DateTimeFormat {
  let format = DAY_FORMATS.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone });
    DAY_FORMATS.set(timeZone, format);
  }
  return format;
}

const DATE_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "7 Oct" */
export function formatDay(at: string | Date, timeZone = 'UTC'): string {
  return dayFormat(timeZone).format(typeof at === 'string' ? new Date(at) : at);
}

/** "7 Oct 2026" */
export function formatDate(at: string | Date): string {
  return DATE_YEAR.format(typeof at === 'string' ? new Date(at) : at);
}

/** "7 Oct – 6 Nov" for a half-open period (the end shown is the last included day). */
export function formatPeriod(period: Period): string {
  const timeZone = period.timeZone ?? 'UTC';
  return `${formatDay(period.start, timeZone)} – ${formatDay(new Date(period.end.getTime() - 1), timeZone)}`;
}
