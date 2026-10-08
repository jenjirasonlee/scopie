import { z } from 'zod';
import { CONTENT_STATUSES, type ContentStatus } from '@/lib/content/shared';
import { utcToZonedParts, zonedDateTimeToUtc } from './time';

// Items sit on the day, and show the time, they fall on in the organization's time zone.
// A calendar day here is a plain date held as UTC midnight (so date arithmetic never meets a
// clock change); only the edges of a range and an item's own timestamp are real instants,
// converted with the helpers in ./time.

export const DAY_MS = 86_400_000;
export const CALENDAR_VIEWS = ['month', 'week', 'list'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

// One list of stages and their labels, shared with the content pages.
export type { ContentStatus } from '@/lib/content/shared';
export { CONTENT_STATUSES, CONTENT_STATUS_LABELS as STATUS_LABELS } from '@/lib/content/shared';

/** A half-open UTC range: `start` included, `end` excluded. */
export type DateRange = { start: Date; end: Date };

export type CalendarFilters = {
  country?: string;
  platform?: string;
  owner?: string;
  status?: ContentStatus;
  pillar?: string;
  campaign?: string;
};

export type CalendarParams = {
  view: CalendarView;
  /** The day the view is anchored on, at UTC midnight. */
  date: Date;
  filters: CalendarFilters;
  /** The item open in the side panel. */
  item?: string;
};

/** Midnight UTC of the day `at` falls on. */
export function startOfDay(at: Date): Date {
  return new Date(Math.floor(at.getTime() / DAY_MS) * DAY_MS);
}

export function addDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * DAY_MS);
}

/** The same day `months` months later, clamped to the last day of a shorter month. */
export function addMonths(at: Date, months: number): Date {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(at.getUTCDate(), lastDay)));
}

export function startOfMonth(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

/** Monday of the week `at` falls in (weeks run Monday to Sunday). */
export function startOfWeek(at: Date): Date {
  const day = startOfDay(at);
  return addDays(day, -((day.getUTCDay() + 6) % 7));
}

/** "2026-10-08" */
export function toDateKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Parses "YYYY-MM-DD" to UTC midnight; null for anything that isn't a real date. */
export function parseDateKey(value: string | undefined | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || toDateKey(date) !== value ? null : date;
}

export function weekRange(at: Date): DateRange {
  const start = startOfWeek(at);
  return { start, end: addDays(start, 7) };
}

/** Every day shown on a month page: whole weeks from the Monday on or before the 1st. */
export function monthGrid(at: Date): Date[][] {
  const first = startOfMonth(at);
  const next = addMonths(first, 1);
  const start = startOfWeek(first);
  const weeks: Date[][] = [];
  for (let day = start; day < next; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
  }
  return weeks;
}

/** Today's date in `timeZone`, as a calendar day. */
export function todayIn(now: Date, timeZone: string): Date {
  return parseDateKey(utcToZonedParts(now, timeZone).date)!;
}

/** The calendar day ("YYYY-MM-DD") a timestamp falls on in `timeZone`. */
export function dayKeyIn(at: string, timeZone: string): string {
  return utcToZonedParts(new Date(at), timeZone).date;
}

/** "09:00", the time a timestamp shows in `timeZone`. */
export function timeIn(at: string, timeZone: string): string {
  return utcToZonedParts(new Date(at), timeZone).time;
}

/** The real instants a range of calendar days covers in `timeZone`, midnight to midnight. */
export function instantRange(range: DateRange, timeZone: string): DateRange {
  return {
    start: zonedDateTimeToUtc(toDateKey(range.start), '00:00', timeZone),
    end: zonedDateTimeToUtc(toDateKey(range.end), '00:00', timeZone),
  };
}

/**
 * The calendar days a view loads items for: the week, the month (list view) or every day on
 * the month grid, including the days of neighbouring months that fill its first and last week.
 */
export function rangeFor(view: CalendarView, date: Date): DateRange {
  if (view === 'week') return weekRange(date);
  const first = startOfMonth(date);
  const next = addMonths(first, 1);
  if (view === 'list') return { start: first, end: next };
  return { start: startOfWeek(first), end: startOfWeek(addDays(next, 6)) };
}

/** The anchor date for the previous (-1) or next (+1) page of a view. */
export function shiftDate(view: CalendarView, date: Date, step: -1 | 1): Date {
  return view === 'week' ? addDays(date, 7 * step) : addMonths(startOfMonth(date), step);
}

// Any UUID shape, so seeded ids that aren't RFC 4122 variants still work.
const uuid = z.guid();

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

function id(value: string | string[] | undefined): string | undefined {
  const raw = single(value);
  return raw && uuid.safeParse(raw).success ? raw.toLowerCase() : undefined;
}

/**
 * Reads `?view=month|week|list&date=YYYY-MM-DD&item=<id>` and the filters. Anything
 * missing or invalid falls back: month view, `today`, no filter.
 */
export function parseCalendarParams(
  search: Record<string, string | string[] | undefined>,
  today: Date,
): CalendarParams {
  const view = single(search.view);
  const country = single(search.country)?.toUpperCase();
  const platform = single(search.platform)?.toLowerCase();
  const status = single(search.status)?.toUpperCase();
  return {
    view: (CALENDAR_VIEWS as readonly string[]).includes(view ?? '')
      ? (view as CalendarView)
      : 'month',
    date: parseDateKey(single(search.date)) ?? today,
    item: id(search.item),
    filters: {
      country: country && /^[A-Z]{2}$/.test(country) ? country : undefined,
      platform: platform && /^[a-z0-9_]{1,30}$/.test(platform) ? platform : undefined,
      owner: id(search.owner),
      status: (CONTENT_STATUSES as readonly string[]).includes(status ?? '')
        ? (status as ContentStatus)
        : undefined,
      pillar: id(search.pillar),
      campaign: id(search.campaign),
    },
  };
}

/**
 * A calendar URL. `date` is left out when it's today, so "Today" and a fresh visit share a
 * URL; filters are kept as they are.
 */
export function calendarHref(
  orgSlug: string,
  params: { view: CalendarView; date?: Date; filters: CalendarFilters; item?: string },
  today?: Date,
): string {
  const query = new URLSearchParams();
  if (params.view !== 'month') query.set('view', params.view);
  if (params.date && (!today || toDateKey(params.date) !== toDateKey(today))) {
    query.set('date', toDateKey(params.date));
  }
  for (const key of ['country', 'platform', 'owner', 'status', 'pillar', 'campaign'] as const) {
    const value = params.filters[key];
    if (value) query.set(key, value);
  }
  if (params.item) query.set('item', params.item);
  const qs = query.toString();
  return `/${orgSlug}/calendar${qs ? `?${qs}` : ''}`;
}

export function hasFilters(filters: CalendarFilters): boolean {
  return Object.values(filters).some(Boolean);
}

/** Published and archived items keep their date; so does anything already published. */
export function canReschedule(item: { status: ContentStatus; publishedAt: string | null }) {
  return item.status !== 'PUBLISHED' && item.status !== 'ARCHIVED' && !item.publishedAt;
}

/**
 * The new publish time when an item moves to `day`: the same local time of day in
 * `timeZone` as before, or 09:00 local when it had no date yet.
 */
export function rescheduledAt(day: Date, previous: string | null, timeZone: string): Date {
  const before = previous ? new Date(previous) : null;
  const time =
    before && !Number.isNaN(before.getTime()) ? utcToZonedParts(before, timeZone).time : '09:00';
  return zonedDateTimeToUtc(toDateKey(day), time, timeZone);
}

// Calendar days are UTC midnights, so they're formatted in UTC to show the right date.
const MONTH = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DAY_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const WEEKDAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const WEEKDAY_SHORT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });

/** "October 2026" */
export const formatMonth = (at: Date) => MONTH.format(at);
/** "8 Oct" */
export const formatDayShort = (at: Date) => DAY.format(at);
/** "8 Oct 2026" */
export const formatDayYear = (at: Date) => DAY_YEAR.format(at);
/** "Thursday 8 October" */
export const formatWeekday = (at: Date) => WEEKDAY.format(at);
/** "Thu" */
export const formatWeekdayShort = (at: Date) => WEEKDAY_SHORT.format(at);

/** The heading for a view: "October 2026" or "5 Oct – 11 Oct 2026". */
export function formatRangeTitle(view: CalendarView, date: Date): string {
  if (view !== 'week') return formatMonth(date);
  const { start, end } = weekRange(date);
  const last = addDays(end, -1);
  return `${formatDayShort(start)} – ${formatDayYear(last)}`;
}

/** Items by the calendar day ("YYYY-MM-DD") they fall on in `timeZone`; undated ones skipped. */
export function groupByDay<T extends { at: string | null }>(
  items: readonly T[],
  timeZone: string,
): Map<string, T[]> {
  const days = new Map<string, T[]>();
  for (const item of items) {
    if (!item.at) continue;
    const key = dayKeyIn(item.at, timeZone);
    const list = days.get(key);
    if (list) list.push(item);
    else days.set(key, [item]);
  }
  return days;
}
