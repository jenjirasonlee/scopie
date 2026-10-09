import { describe, expect, it } from 'vitest';
import {
  addMonths,
  calendarHref,
  canReschedule,
  dayKeyIn,
  formatRangeTitle,
  groupByDay,
  instantRange,
  monthGrid,
  parseCalendarParams,
  parseDateKey,
  rangeFor,
  rescheduledAt,
  shiftDate,
  startOfWeek,
  todayIn,
  toDateKey,
  weekRange,
} from '@/lib/calendar/dates';
import { safeTimeZone, utcToZonedParts, zonedDateTimeToUtc } from '@/lib/calendar/time';

const day = (key: string) => parseDateKey(key)!;
const keys = (dates: Date[]) => dates.map(toDateKey);
const ID = '3f1b6f0e-8a4c-4d55-9a1b-2c3d4e5f6a7b';

describe('calendar dates', () => {
  it('parses only real YYYY-MM-DD dates', () => {
    expect(toDateKey(day('2026-10-08'))).toBe('2026-10-08');
    expect(parseDateKey('2026-02-29')).toBeNull();
    expect(parseDateKey('2028-02-29')).not.toBeNull();
    expect(parseDateKey('2026-13-01')).toBeNull();
    expect(parseDateKey('2026-1-1')).toBeNull();
    expect(parseDateKey('yesterday')).toBeNull();
    expect(parseDateKey(undefined)).toBeNull();
  });

  it('starts weeks on Monday', () => {
    expect(toDateKey(startOfWeek(day('2026-10-08')))).toBe('2026-10-05'); // Thursday
    expect(toDateKey(startOfWeek(day('2026-10-05')))).toBe('2026-10-05'); // Monday
    expect(toDateKey(startOfWeek(day('2026-10-11')))).toBe('2026-10-05'); // Sunday
    const week = weekRange(day('2026-10-11'));
    expect(keys([week.start, week.end])).toEqual(['2026-10-05', '2026-10-12']);
  });

  it('crosses month and year boundaries in week ranges', () => {
    const week = weekRange(day('2027-01-01')); // Friday
    expect(keys([week.start, week.end])).toEqual(['2026-12-28', '2027-01-04']);
  });

  it('builds a month grid of whole weeks', () => {
    // October 2026 starts on a Thursday and ends on a Saturday: five weeks.
    const october = monthGrid(day('2026-10-08'));
    expect(october).toHaveLength(5);
    expect(october.every((week) => week.length === 7)).toBe(true);
    expect(toDateKey(october[0]![0]!)).toBe('2026-09-28');
    expect(toDateKey(october[4]![6]!)).toBe('2026-11-01');

    // February 2027 starts on a Monday and ends on a Sunday: exactly four weeks.
    const february = monthGrid(day('2027-02-14'));
    expect(february).toHaveLength(4);
    expect(toDateKey(february[0]![0]!)).toBe('2027-02-01');
    expect(toDateKey(february[3]![6]!)).toBe('2027-02-28');

    // August 2026 starts on a Saturday and ends on a Monday: six weeks.
    expect(monthGrid(day('2026-08-01'))).toHaveLength(6);
  });

  it('loads the grid, the week or the month', () => {
    const month = rangeFor('month', day('2026-10-08'));
    expect(keys([month.start, month.end])).toEqual(['2026-09-28', '2026-11-02']);
    const list = rangeFor('list', day('2026-10-08'));
    expect(keys([list.start, list.end])).toEqual(['2026-10-01', '2026-11-01']);
    const week = rangeFor('week', day('2026-10-08'));
    expect(keys([week.start, week.end])).toEqual(['2026-10-05', '2026-10-12']);
  });

  it('moves between months and years', () => {
    expect(toDateKey(addMonths(day('2026-01-31'), 1))).toBe('2026-02-28');
    expect(toDateKey(shiftDate('month', day('2026-12-15'), 1))).toBe('2027-01-01');
    expect(toDateKey(shiftDate('list', day('2027-01-15'), -1))).toBe('2026-12-01');
    expect(toDateKey(shiftDate('week', day('2026-12-29'), 1))).toBe('2027-01-05');
    expect(toDateKey(shiftDate('week', day('2027-01-02'), -1))).toBe('2026-12-26');
  });

  it('titles the period', () => {
    expect(formatRangeTitle('month', day('2026-10-08'))).toBe('October 2026');
    expect(formatRangeTitle('week', day('2026-12-30'))).toBe('28 Dec – 3 Jan 2027');
  });
});

describe('calendar params', () => {
  const today = day('2026-10-08');

  it('falls back to month view, today and no filters', () => {
    expect(parseCalendarParams({}, today)).toEqual({
      view: 'month',
      date: today,
      item: undefined,
      filters: {
        country: undefined,
        platform: undefined,
        owner: undefined,
        status: undefined,
        pillar: undefined,
        campaign: undefined,
      },
    });
  });

  it('reads valid params', () => {
    const params = parseCalendarParams(
      {
        view: 'week',
        date: '2026-12-31',
        item: ID,
        country: 'es',
        platform: 'Instagram',
        owner: ID,
        status: 'draft',
        pillar: ID,
        campaign: [ID, 'other'],
      },
      today,
    );
    expect(params.view).toBe('week');
    expect(toDateKey(params.date)).toBe('2026-12-31');
    expect(params.item).toBe(ID);
    expect(params.filters).toEqual({
      country: 'ES',
      platform: 'instagram',
      owner: ID,
      status: 'DRAFT',
      pillar: ID,
      campaign: ID,
    });
  });

  it('ignores invalid params', () => {
    const params = parseCalendarParams(
      {
        view: 'year',
        date: '2026-02-30',
        item: 'not-an-id',
        country: 'Spain',
        platform: 'insta gram',
        owner: '1',
        status: 'DONE',
        pillar: '',
        campaign: "'; drop table",
      },
      today,
    );
    expect(params.view).toBe('month');
    expect(params.date).toEqual(today);
    expect(params.item).toBeUndefined();
    expect(Object.values(params.filters).every((value) => value === undefined)).toBe(true);
  });

  it('builds URLs that read back the same', () => {
    const href = calendarHref(
      'canna-demo',
      {
        view: 'week',
        date: day('2026-11-02'),
        filters: { status: 'IDEA', country: 'NL' },
        item: ID,
      },
      today,
    );
    expect(href).toBe(
      `/canna-demo/calendar?view=week&date=2026-11-02&country=NL&status=IDEA&item=${ID}`,
    );
    const search = Object.fromEntries(new URL(href, 'http://x').searchParams);
    const params = parseCalendarParams(search, today);
    expect(params).toMatchObject({
      view: 'week',
      item: ID,
      filters: { status: 'IDEA', country: 'NL' },
    });
    // Today and month view are the defaults, so they're left out.
    expect(calendarHref('canna-demo', { view: 'month', date: today, filters: {} }, today)).toBe(
      '/canna-demo/calendar',
    );
  });
});

describe('time zones', () => {
  it('converts wall-clock time to UTC and back', () => {
    const at = zonedDateTimeToUtc('2026-10-08', '09:00', 'Europe/Amsterdam');
    expect(at.toISOString()).toBe('2026-10-08T07:00:00.000Z'); // summer time, UTC+2
    expect(utcToZonedParts(at, 'Europe/Amsterdam')).toEqual({ date: '2026-10-08', time: '09:00' });
    expect(zonedDateTimeToUtc('2026-12-08', '09:00', 'Europe/Amsterdam').toISOString()).toBe(
      '2026-12-08T08:00:00.000Z', // winter time, UTC+1
    );
    expect(zonedDateTimeToUtc('2026-10-08', '20:00', 'America/New_York').toISOString()).toBe(
      '2026-10-09T00:00:00.000Z',
    );
    expect(utcToZonedParts(new Date('2026-10-08T23:30:00Z'), 'Asia/Tokyo')).toEqual({
      date: '2026-10-09',
      time: '08:30',
    });
  });

  it('handles the days clocks change', () => {
    // Amsterdam, 29 March 2026: 02:00 jumps to 03:00. 02:30 doesn't exist and moves forward.
    expect(zonedDateTimeToUtc('2026-03-29', '01:30', 'Europe/Amsterdam').toISOString()).toBe(
      '2026-03-29T00:30:00.000Z',
    );
    expect(zonedDateTimeToUtc('2026-03-29', '02:30', 'Europe/Amsterdam').toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
    expect(zonedDateTimeToUtc('2026-03-29', '09:00', 'Europe/Amsterdam').toISOString()).toBe(
      '2026-03-29T07:00:00.000Z',
    );
    // Amsterdam, 25 October 2026: 03:00 goes back to 02:00. 02:30 happens twice; the later wins.
    expect(zonedDateTimeToUtc('2026-10-25', '02:30', 'Europe/Amsterdam').toISOString()).toBe(
      '2026-10-25T01:30:00.000Z',
    );
    expect(zonedDateTimeToUtc('2026-10-25', '09:00', 'Europe/Amsterdam').toISOString()).toBe(
      '2026-10-25T08:00:00.000Z',
    );
    // New York, 8 March 2026: 02:30 doesn't exist and moves forward to 03:30 EDT.
    expect(zonedDateTimeToUtc('2026-03-08', '02:30', 'America/New_York').toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    // New York, 1 November 2026: 01:30 happens twice; the later (EST) wins.
    expect(zonedDateTimeToUtc('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe(
      '2026-11-01T06:30:00.000Z',
    );
  });

  it('treats unknown zones as UTC and rejects bad input', () => {
    expect(safeTimeZone('Mars/Olympus')).toBe('UTC');
    expect(safeTimeZone(null)).toBe('UTC');
    expect(safeTimeZone('Europe/Madrid')).toBe('Europe/Madrid');
    expect(zonedDateTimeToUtc('2026-10-08', '09:00', 'Mars/Olympus').toISOString()).toBe(
      '2026-10-08T09:00:00.000Z',
    );
    expect(() => zonedDateTimeToUtc('8/10/2026', '9am', 'UTC')).toThrow(RangeError);
  });

  it('places items on the local day', () => {
    const now = new Date('2026-10-08T23:30:00Z');
    expect(toDateKey(todayIn(now, 'UTC'))).toBe('2026-10-08');
    expect(toDateKey(todayIn(now, 'Europe/Amsterdam'))).toBe('2026-10-09');
    expect(dayKeyIn('2026-10-08T22:30:00Z', 'Europe/Amsterdam')).toBe('2026-10-09');

    const items = [
      { id: 'a', at: '2026-10-08T21:59:00Z' },
      { id: 'b', at: '2026-10-08T22:00:00Z' },
      { id: 'c', at: null },
    ];
    const byDay = groupByDay(items, 'Europe/Amsterdam');
    expect(byDay.get('2026-10-08')?.map((i) => i.id)).toEqual(['a']);
    expect(byDay.get('2026-10-09')?.map((i) => i.id)).toEqual(['b']);
    expect([...byDay.values()].flat()).toHaveLength(2);
  });

  it('covers local midnight to midnight, across a clock change', () => {
    const range = instantRange(rangeFor('week', day('2026-10-21')), 'Europe/Amsterdam');
    expect(range.start.toISOString()).toBe('2026-10-18T22:00:00.000Z'); // Mon 19 Oct, CEST
    expect(range.end.toISOString()).toBe('2026-10-25T23:00:00.000Z'); // Mon 26 Oct, CET
  });
});

describe('rescheduling', () => {
  it('keeps the local time of day, even across a clock change', () => {
    // 18:45 in Amsterdam (CEST) moved to after the change stays 18:45 local (CET).
    expect(
      rescheduledAt(day('2026-10-30'), '2026-10-20T16:45:00Z', 'Europe/Amsterdam').toISOString(),
    ).toBe('2026-10-30T17:45:00.000Z');
    expect(rescheduledAt(day('2026-11-03'), '2026-10-20T16:45:00Z', 'UTC').toISOString()).toBe(
      '2026-11-03T16:45:00.000Z',
    );
  });

  it('defaults to 09:00 local when there was no date', () => {
    expect(rescheduledAt(day('2026-10-30'), null, 'Europe/Amsterdam').toISOString()).toBe(
      '2026-10-30T08:00:00.000Z',
    );
    expect(rescheduledAt(day('2026-10-30'), null, 'UTC').toISOString()).toBe(
      '2026-10-30T09:00:00.000Z',
    );
  });

  it('leaves published and archived content where it is', () => {
    expect(canReschedule({ status: 'DRAFT', publishedAt: null })).toBe(true);
    expect(canReschedule({ status: 'PUBLISHED', publishedAt: null })).toBe(false);
    expect(canReschedule({ status: 'ARCHIVED', publishedAt: null })).toBe(false);
    expect(canReschedule({ status: 'ANALYSED', publishedAt: '2026-10-01T10:00:00Z' })).toBe(false);
  });
});
