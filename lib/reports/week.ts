import { zonedDateTimeToUtc } from '@/lib/calendar/time';
import type { Period } from '@/lib/analytics/types';
import { todayIn } from '@/lib/strategy/shared';
import type { ReportWeek } from './types';

// Report weeks run Monday to Sunday in the organization's time zone (ISO weeks).

const DAY_MS = 86_400_000;

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** ISO weekday of a date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: string): number {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** The last week that has fully ended, in the time zone. */
export function lastFullWeek(now: Date, timeZone: string): ReportWeek {
  const today = todayIn(timeZone, now);
  const thisMonday = addDays(today, 1 - isoWeekday(today));
  return { start: addDays(thisMonday, -7), end: addDays(thisMonday, -1) };
}

export function previousWeek(week: ReportWeek): ReportWeek {
  return { start: addDays(week.start, -7), end: addDays(week.end, -7) };
}

/** The week as instants: Monday 00:00 to the next Monday 00:00 in the time zone. */
export function weekPeriod(week: ReportWeek, timeZone: string): Period {
  return {
    start: zonedDateTimeToUtc(week.start, '00:00', timeZone),
    end: zonedDateTimeToUtc(addDays(week.end, 1), '00:00', timeZone),
    timeZone,
  };
}

/** Local hour of the day in the time zone, 0–23. */
export function localHour(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone })
    .formatToParts(now)
    .find((part) => part.type === 'hour')?.value;
  return Number(hour ?? '0') % 24;
}
