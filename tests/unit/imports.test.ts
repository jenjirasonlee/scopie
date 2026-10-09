import { describe, expect, it } from 'vitest';
import { normalizeHeader, parseCsv } from '@/lib/imports/csv';
import { parseDateTime, parseImport, parseNumber } from '@/lib/imports/parse';
import { ACCOUNT_METRIC_COLUMNS, POST_METRIC_COLUMNS, TEMPLATES } from '@/lib/imports/templates';
import { isStorableMetric } from '@/lib/metrics/registry';

const NOW = new Date('2026-10-01T12:00:00Z');

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded commas and line breaks', () => {
    const rows = parseCsv('a,b,c\r\n"x, y","say ""hi""","line\nbreak"\r\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line\nbreak'],
    ]);
  });

  it('strips a byte order mark, skips blank lines and keeps a last row without newline', () => {
    expect(parseCsv('﻿a,b\n\n1,2\n,\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('detects semicolon-separated exports', () => {
    expect(parseCsv('date;followers\n2026-09-01;120')).toEqual([
      ['date', 'followers'],
      ['2026-09-01', '120'],
    ]);
  });

  it('rejects an unclosed quote', () => {
    expect(() => parseCsv('a\n"oops')).toThrow(/unclosed quote/);
  });

  it('normalizes headers', () => {
    expect(normalizeHeader('  Post Link ')).toBe('post_link');
    expect(normalizeHeader('Total Interactions (%)')).toBe('total_interactions');
  });
});

describe('value parsing', () => {
  it('treats empty, dash and n/a as not provided, and 0 as a real zero', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(' - ')).toBeNull();
    expect(parseNumber('N/A')).toBeNull();
    expect(parseNumber('0')).toBe(0);
    expect(parseNumber('12.5%')).toBe(12.5);
  });

  it('refuses ambiguous or negative numbers', () => {
    for (const raw of ['1,234', '1.234,5', '-3', 'abc', '1e3'])
      expect(parseNumber(raw)).toBe('invalid');
  });

  it('reads dates and times, with a date alone at 12:00 UTC', () => {
    expect(parseDateTime('2026-09-01')).toBe('2026-09-01T12:00:00.000Z');
    expect(parseDateTime('2026-09-01 14:30')).toBe('2026-09-01T14:30:00.000Z');
    expect(parseDateTime('2026-09-01T14:30:00+02:00')).toBe('2026-09-01T12:30:00.000Z');
    expect(parseDateTime('01/09/2026')).toBeNull();
    expect(parseDateTime('2026-02-30')).toBeNull();
  });
});

describe('templates', () => {
  it('only map to metrics the database stores', () => {
    for (const { metricKey } of Object.values(ACCOUNT_METRIC_COLUMNS)) {
      expect(isStorableMetric(metricKey, 'account'), metricKey).toBe(true);
    }
    for (const key of POST_METRIC_COLUMNS) expect(isStorableMetric(key, 'post'), key).toBe(true);
  });

  it('example files import cleanly', () => {
    const accounts = parseImport('account_metrics', TEMPLATES.account_metrics.example, NOW);
    expect(accounts.errors).toEqual([]);
    expect(accounts.rowsValid).toBe(2);
    const posts = parseImport('posts', TEMPLATES.posts.example, NOW);
    expect(posts.errors).toEqual([]);
    expect(posts.rowsValid).toBe(1);
  });
});

describe('parseImport: account metrics', () => {
  it('stores provided values only; an empty cell is never a zero', () => {
    const result = parseImport(
      'account_metrics',
      'date,followers,reach\n2026-09-01,100,0\n2026-09-02,101,\n',
      NOW,
    );
    expect(result.errors).toEqual([]);
    expect(result.accountMetrics).toEqual([
      expect.objectContaining({
        metricKey: 'followers',
        value: 100,
        period: 'lifetime',
        metricDate: '2026-09-01',
      }),
      expect.objectContaining({
        metricKey: 'reach',
        value: 0,
        period: 'day',
        metricDate: '2026-09-01',
      }),
      expect.objectContaining({ metricKey: 'followers', value: 101, metricDate: '2026-09-02' }),
    ]);
    expect(result.accountMetrics.every((metric) => metric.availability === 'available')).toBe(true);
  });

  it('reports bad rows with their row number and keeps the good ones', () => {
    const result = parseImport(
      'account_metrics',
      'date,followers\n2026-09-01,100\n09/02/2026,101\n2026-09-03,-4\n2026-09-01,99\n2026-09-04,\n',
      NOW,
    );
    expect(result.rowsTotal).toBe(5);
    expect(result.rowsValid).toBe(1);
    expect(result.errors.map((error) => error.row)).toEqual([3, 4, 5, 6]);
  });

  it('recognises export column names and lists the ones it ignores', () => {
    const result = parseImport(
      'account_metrics',
      'Date,New followers,Page views,Mood\n2026-09-01,4,10,happy\n',
      NOW,
    );
    expect(result.ignoredColumns).toEqual(['Mood']);
    expect(result.accountMetrics.map((metric) => metric.metricKey)).toEqual([
      'followers_gained',
      'profile_views',
    ]);
  });

  it('needs a date column and at least one metric', () => {
    expect(parseImport('account_metrics', 'followers\n1\n', NOW).errors[0]!.message).toMatch(
      /date/,
    );
    expect(
      parseImport('account_metrics', 'date,mood\n2026-09-01,ok\n', NOW).errors[0]!.message,
    ).toMatch(/No metric columns/);
  });
});

describe('parseImport: posts', () => {
  it('reads a LinkedIn-style export', () => {
    const csv =
      'Post link,Created date,Post type,Impressions,Clicks,Reposts,Reactions\n' +
      'https://www.linkedin.com/feed/update/urn:li:share:1,2026-09-01,Image,4210,38,5,96\n';
    const result = parseImport('posts', csv, NOW);
    expect(result.errors).toEqual([]);
    const [group] = result.postGroups;
    expect(group!.capturedAt).toBe(NOW.toISOString());
    expect(group!.posts[0]).toMatchObject({
      externalId: 'https://www.linkedin.com/feed/update/urn:li:share:1',
      publishedAt: '2026-09-01T12:00:00.000Z',
      mediaFormat: 'image',
    });
    expect(
      Object.fromEntries(group!.metrics.map((metric) => [metric.metricKey, metric.value])),
    ).toEqual({
      impressions: 4210,
      reactions: 96,
      shares: 5,
      link_clicks: 38,
    });
  });

  it('groups rows by capture time so a post can have several snapshots', () => {
    const csv =
      'post_id,published_at,captured_at,reach\n' +
      'p1,2026-09-01T09:00:00Z,2026-09-02,100\n' +
      'p1,2026-09-01T09:00:00Z,2026-09-08,180\n' +
      'p2,2026-09-03T09:00:00Z,2026-09-08,50\n';
    const result = parseImport('posts', csv, NOW);
    expect(result.errors).toEqual([]);
    expect(
      result.postGroups.map((group) => [
        group.capturedAt,
        group.posts.map((post) => post.externalId),
      ]),
    ).toEqual([
      ['2026-09-02T12:00:00.000Z', ['p1']],
      ['2026-09-08T12:00:00.000Z', ['p1', 'p2']],
    ]);
  });

  it('rejects impossible capture times and duplicates', () => {
    const csv =
      'post_id,published_at,captured_at,reach\n' +
      'p1,2026-09-05T09:00:00Z,2026-09-04,1\n' +
      'p2,2026-09-05T09:00:00Z,2027-01-01,1\n' +
      'p3,2026-09-05T09:00:00Z,,1\n' +
      'p3,2026-09-05T09:00:00Z,,2\n' +
      'p4,2026-09-05T09:00:00Z,,101\n';
    const result = parseImport('posts', csv.replace('reach', 'completion_rate'), NOW);
    expect(result.errors.map((error) => [error.row, error.message])).toEqual([
      [2, expect.stringMatching(/before the post was published/)],
      [3, expect.stringMatching(/future/)],
      [5, expect.stringMatching(/twice/)],
      [6, expect.stringMatching(/0 to 100/)],
    ]);
    expect(result.rowsValid).toBe(1);
  });

  it('needs a publish time and an id or link', () => {
    expect(parseImport('posts', 'post_id\np1\n', NOW).errors[0]!.message).toMatch(/published_at/);
    expect(parseImport('posts', 'published_at\n2026-09-01\n', NOW).errors[0]!.message).toMatch(
      /post_id/,
    );
  });

  it('refuses an empty file', () => {
    expect(parseImport('posts', 'post_id,published_at\n', NOW).errors[0]!.message).toMatch(
      /no data rows/,
    );
  });
});
