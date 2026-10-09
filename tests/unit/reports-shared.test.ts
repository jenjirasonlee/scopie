import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TEXT } from '@/lib/approvals/shared';
import { notificationHref } from '@/lib/notifications/shared';
import {
  formatDay,
  formatWeek,
  madeByLine,
  madeByShort,
  readSnapshot,
  reportReadyText,
  reportWriterSentences,
  safeExternalUrl,
} from '@/lib/reports/shared';
import { REPORT_SNAPSHOT_FIXTURE } from '../fixtures/report-snapshot';

const clone = () => structuredClone(REPORT_SNAPSHOT_FIXTURE) as Record<string, unknown>;

describe('report weeks', () => {
  it('shows a week as the days it covers', () => {
    expect(formatWeek({ start: '2026-09-28', end: '2026-10-04' })).toBe('28 Sept – 4 Oct 2026');
    expect(formatWeek({ start: '2026-10-05', end: '2026-10-11' })).toBe('5 Oct – 11 Oct 2026');
    expect(formatWeek({ start: '2025-12-29', end: '2026-01-04' })).toBe('29 Dec 2025 – 4 Jan 2026');
  });

  it('can leave the year out', () => {
    expect(formatWeek({ start: '2026-09-28', end: '2026-10-04' }, { year: false })).toBe(
      '28 Sept – 4 Oct',
    );
  });

  it('gives up on dates it can’t read', () => {
    expect(formatWeek({ start: 'soon', end: '2026-10-04' })).toBeNull();
    expect(formatWeek({ start: '2026-10-04', end: '2026-09-28' })).toBeNull();
  });

  it('shows single days, plain dates as they are and timestamps in the time zone', () => {
    expect(formatDay('2026-10-04', 'Pacific/Auckland')).toBe('4 Oct 2026');
    expect(formatDay('2026-10-04T23:30:00Z', 'Europe/Amsterdam')).toBe('5 Oct 2026');
    expect(formatDay('not a date', 'UTC')).toBeNull();
  });
});

describe('who made a report', () => {
  const at = '2026-10-05T04:00:00Z';

  it('says when it was made automatically or by whom', () => {
    expect(madeByLine('schedule', null, at, 'Europe/Amsterdam')).toBe(
      'Made automatically on 5 Oct 2026, 06:00',
    );
    expect(madeByLine('manual', 'Sam Jansen', at, 'Europe/Amsterdam')).toBe(
      'Made by Sam Jansen on 5 Oct 2026, 06:00',
    );
    expect(madeByLine('manual', null, at, 'UTC')).toBe('Made on request on 5 Oct 2026, 04:00');
  });

  it('has a short form for the list', () => {
    expect(madeByShort('schedule', 'Sam')).toBe('Automatically');
    expect(madeByShort('manual', 'Sam')).toBe('Sam');
    expect(madeByShort('manual', null)).toContain('On request');
  });

  it('says who wrote the words', () => {
    const rules = reportWriterSentences(REPORT_SNAPSHOT_FIXTURE.analysis, 'Europe/Amsterdam');
    expect(rules[0]).toBe(
      'The insights and recommended actions come from the analysis of 8 Sept – 4 Oct 2026, written by Scopie’s own rules (no AI model).',
    );
    expect(rules[1]).toContain('always written by Scopie’s own rules');

    const model = reportWriterSentences(
      { ...REPORT_SNAPSHOT_FIXTURE.analysis!, writer: 'model', model: 'claude-test' },
      'Europe/Amsterdam',
    );
    expect(model[0]).toContain('worded by the AI model claude-test and checked by Scopie');

    expect(reportWriterSentences(null, 'UTC')[0]).toContain('No analysis could be made');
  });
});

describe('reading a stored snapshot', () => {
  it('reads the fixture as it is', () => {
    const result = readSnapshot(REPORT_SNAPSHOT_FIXTURE);
    expect(result).toEqual({ status: 'ok', snapshot: REPORT_SNAPSHOT_FIXTURE });
  });

  it('keeps unknown numbers unknown, never 0', () => {
    const result = readSnapshot(REPORT_SNAPSHOT_FIXTURE);
    if (result.status !== 'ok') throw new Error('expected ok');
    const reviews = result.snapshot.kpis.find((kpi) => kpi.key === 'reviews');
    expect(reviews?.value).toBeNull();
    expect(reviews?.unavailable).toBeTruthy();
  });

  it('turns a non-number into unknown rather than a value', () => {
    const raw = clone();
    (raw.kpis as Record<string, unknown>[])[0]!.value = 'lots';
    const result = readSnapshot(raw);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.snapshot.kpis[0]!.value).toBeNull();
  });

  it('recognises a snapshot from a newer version', () => {
    expect(readSnapshot({ ...clone(), version: 2 })).toEqual({ status: 'newer' });
    expect(readSnapshot({ version: 7, anything: true })).toEqual({ status: 'newer' });
  });

  it('refuses what it can’t read', () => {
    expect(readSnapshot(null)).toEqual({ status: 'unreadable' });
    expect(readSnapshot([])).toEqual({ status: 'unreadable' });
    expect(readSnapshot({ ...clone(), version: 0 })).toEqual({ status: 'unreadable' });
    expect(readSnapshot({ ...clone(), week: undefined })).toEqual({ status: 'unreadable' });
  });

  it('leaves out list items it can’t read and keeps the rest', () => {
    const raw = clone();
    raw.topContent = [...(raw.topContent as unknown[]), { profile: 'broken' }];
    raw.notes = 'not a list';
    const result = readSnapshot(raw);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.snapshot.topContent).toHaveLength(REPORT_SNAPSHOT_FIXTURE.topContent.length);
    expect(result.snapshot.notes).toEqual([]);
  });

  it('reads a report without an analysis', () => {
    const result = readSnapshot({ ...clone(), analysis: null });
    expect(result.status === 'ok' && result.snapshot.analysis).toBeNull();
  });
});

describe('post links', () => {
  it('only allows web links', () => {
    expect(safeExternalUrl('https://example.com/p/1')).toBe('https://example.com/p/1');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('/relative')).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });
});

describe('report notifications', () => {
  const reportId = '44444444-4444-4444-8444-444444444444';

  it('says which week is ready', () => {
    expect(reportReadyText({ start: '2026-09-28', end: '2026-10-04' })).toBe(
      'Weekly report for 28 Sept – 4 Oct is ready',
    );
    expect(reportReadyText(null)).toBe('A weekly report is ready');
  });

  it('opens the report', () => {
    expect(notificationHref('acme', { kind: 'report_ready', itemId: null, reportId })).toBe(
      `/acme/reports/${reportId}`,
    );
    expect(notificationHref('acme', { kind: 'report_ready', itemId: null, reportId: null })).toBe(
      null,
    );
    expect(NOTIFICATION_TEXT.report_ready).toBeTruthy();
  });
});
