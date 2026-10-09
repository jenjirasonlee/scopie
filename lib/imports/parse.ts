import type {
  MediaFormat,
  NormalizedAccountMetric,
  NormalizedPost,
  NormalizedPostMetric,
} from '@/lib/platforms/types';
import { normalizeHeader, parseCsv } from './csv';
import {
  ACCOUNT_METRIC_COLUMNS,
  COLUMN_ALIASES,
  MEDIA_FORMAT_ALIASES,
  POST_METRIC_COLUMNS,
  type ImportKind,
} from './templates';

export type RowError = { row: number; message: string };

/** Posts that share a capture time are stored together (one snapshot time per batch). */
export type PostGroup = {
  capturedAt: string;
  posts: NormalizedPost[];
  metrics: NormalizedPostMetric[];
};

export type ParsedImport = {
  kind: ImportKind;
  rowsTotal: number;
  rowsValid: number;
  errors: RowError[];
  ignoredColumns: string[];
  accountMetrics: NormalizedAccountMetric[];
  postGroups: PostGroup[];
};

export const MAX_IMPORT_ROWS = 5000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads a number as written in an export. Empty means "not provided", never zero. */
export function parseNumber(raw: string): number | null | 'invalid' {
  const value = raw.trim();
  if (value === '' || value === '-' || value.toLowerCase() === 'n/a') return null;
  const cleaned = value.replace(/%$/, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return 'invalid';
  return Number(cleaned);
}

function parseDate(raw: string): string | null {
  const value = raw.trim();
  if (!DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

/** ISO date-time with offset, "YYYY-MM-DD HH:MM[:SS]" (read as UTC) or a date alone (12:00 UTC). */
export function parseDateTime(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const date = parseDate(value);
  if (date) return `${date}T12:00:00.000Z`;
  const spaced = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(:\d{2})?)$/.exec(value);
  const candidate = spaced ? `${spaced[1]}T${spaced[2]}Z` : value;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(candidate)) return null;
  const parsed = Date.parse(candidate);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function headerMap(headers: string[], known: Set<string>) {
  const columns = new Map<string, number>();
  const ignored: string[] = [];
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    const name = known.has(normalized) ? normalized : (COLUMN_ALIASES[normalized] ?? normalized);
    if (known.has(name) && !columns.has(name)) columns.set(name, index);
    else if (header.trim()) ignored.push(header.trim());
  });
  return { columns, ignored };
}

export function parseImport(kind: ImportKind, text: string, now: Date = new Date()): ParsedImport {
  const rows = parseCsv(text);
  const result: ParsedImport = {
    kind,
    rowsTotal: Math.max(0, rows.length - 1),
    rowsValid: 0,
    errors: [],
    ignoredColumns: [],
    accountMetrics: [],
    postGroups: [],
  };
  if (rows.length < 2) {
    result.errors.push({ row: 1, message: 'The file has no data rows under the header.' });
    return result;
  }
  if (result.rowsTotal > MAX_IMPORT_ROWS) {
    result.errors.push({ row: 1, message: `Import at most ${MAX_IMPORT_ROWS} rows per file.` });
    return result;
  }
  return kind === 'account_metrics'
    ? parseAccountMetrics(rows, result)
    : parsePosts(rows, result, now);
}

function parseAccountMetrics(rows: string[][], result: ParsedImport): ParsedImport {
  const known = new Set(['date', ...Object.keys(ACCOUNT_METRIC_COLUMNS)]);
  const { columns, ignored } = headerMap(rows[0]!, known);
  result.ignoredColumns = ignored;
  if (!columns.has('date')) {
    result.errors.push({ row: 1, message: 'Missing the "date" column.' });
    return result;
  }
  const metricColumns = [...columns.keys()].filter((name) => name !== 'date');
  if (!metricColumns.length) {
    result.errors.push({ row: 1, message: 'No metric columns found (e.g. followers, reach).' });
    return result;
  }

  const seenDates = new Set<string>();
  rows.slice(1).forEach((cells, offset) => {
    const rowNumber = offset + 2;
    const date = parseDate(cells[columns.get('date')!] ?? '');
    if (!date) {
      result.errors.push({ row: rowNumber, message: 'Date must look like 2026-09-01.' });
      return;
    }
    if (seenDates.has(date)) {
      result.errors.push({ row: rowNumber, message: `${date} appears more than once.` });
      return;
    }
    seenDates.add(date);
    const metrics: NormalizedAccountMetric[] = [];
    for (const name of metricColumns) {
      const value = parseNumber(cells[columns.get(name)!] ?? '');
      if (value === 'invalid') {
        result.errors.push({
          row: rowNumber,
          message: `"${name}" must be a plain number like 1234.`,
        });
        return;
      }
      if (value === null) continue; // not provided: no row, never a zero
      const { metricKey, period } = ACCOUNT_METRIC_COLUMNS[name]!;
      metrics.push({
        metricKey,
        sourceMetric: `csv:${name}`,
        value,
        availability: 'available',
        period,
        metricDate: date,
      });
    }
    if (!metrics.length) {
      result.errors.push({ row: rowNumber, message: 'No values on this row.' });
      return;
    }
    result.accountMetrics.push(...metrics);
    result.rowsValid += 1;
  });
  return result;
}

function parsePosts(rows: string[][], result: ParsedImport, now: Date): ParsedImport {
  const known = new Set<string>([
    'post_id',
    'published_at',
    'permalink',
    'caption',
    'format',
    'captured_at',
    ...POST_METRIC_COLUMNS,
  ]);
  const { columns, ignored } = headerMap(rows[0]!, known);
  result.ignoredColumns = ignored;
  for (const required of ['published_at'] as const) {
    if (!columns.has(required)) {
      result.errors.push({ row: 1, message: `Missing the "${required}" column.` });
      return result;
    }
  }
  if (!columns.has('post_id') && !columns.has('permalink')) {
    result.errors.push({ row: 1, message: 'Missing a "post_id" or "permalink" column.' });
    return result;
  }
  const cell = (cells: string[], name: string) =>
    columns.has(name) ? (cells[columns.get(name)!] ?? '').trim() : '';

  const groups = new Map<string, PostGroup>();
  const seen = new Set<string>();
  const importTime = now.toISOString();

  rows.slice(1).forEach((cells, offset) => {
    const rowNumber = offset + 2;
    const externalId = cell(cells, 'post_id') || cell(cells, 'permalink');
    if (!externalId) {
      result.errors.push({ row: rowNumber, message: 'Missing the post ID or link.' });
      return;
    }
    const publishedAt = parseDateTime(cell(cells, 'published_at'));
    if (!publishedAt) {
      result.errors.push({
        row: rowNumber,
        message: 'Publish time must look like 2026-09-01T14:30:00Z.',
      });
      return;
    }
    const capturedRaw = cell(cells, 'captured_at');
    const capturedAt = capturedRaw ? parseDateTime(capturedRaw) : importTime;
    if (!capturedAt) {
      result.errors.push({
        row: rowNumber,
        message: 'captured_at must be a date or date and time.',
      });
      return;
    }
    if (Date.parse(capturedAt) > now.getTime()) {
      result.errors.push({ row: rowNumber, message: 'captured_at is in the future.' });
      return;
    }
    if (Date.parse(capturedAt) < Date.parse(publishedAt)) {
      result.errors.push({
        row: rowNumber,
        message: 'captured_at is before the post was published.',
      });
      return;
    }
    const key = `${externalId}@${capturedAt}`;
    if (seen.has(key)) {
      result.errors.push({
        row: rowNumber,
        message: 'This post appears twice with the same captured_at.',
      });
      return;
    }
    const formatRaw = normalizeHeader(cell(cells, 'format'));
    const mediaFormat: MediaFormat = formatRaw
      ? (MEDIA_FORMAT_ALIASES[formatRaw] ?? 'other')
      : 'other';

    const metrics: NormalizedPostMetric[] = [];
    for (const name of POST_METRIC_COLUMNS) {
      if (!columns.has(name)) continue;
      const value = parseNumber(cell(cells, name));
      if (value === 'invalid') {
        result.errors.push({
          row: rowNumber,
          message: `"${name}" must be a plain number like 1234.`,
        });
        return;
      }
      if (value === null) continue;
      if (name === 'completion_rate' && value > 100) {
        result.errors.push({
          row: rowNumber,
          message: 'completion_rate is a percentage from 0 to 100.',
        });
        return;
      }
      metrics.push({
        postExternalId: externalId,
        metricKey: name,
        sourceMetric: `csv:${name}`,
        value,
        availability: 'available',
        period: 'lifetime',
        metricDate: null,
      });
    }
    seen.add(key);

    const group = groups.get(capturedAt) ?? { capturedAt, posts: [], metrics: [] };
    groups.set(capturedAt, group);
    if (!group.posts.some((post) => post.externalId === externalId)) {
      group.posts.push({
        externalId,
        publishedAt,
        permalink: cell(cells, 'permalink') || null,
        caption: cell(cells, 'caption') || null,
        mediaFormat,
        nativeType: cell(cells, 'format') || null,
      });
    }
    group.metrics.push(...metrics);
    result.rowsValid += 1;
  });
  result.postGroups = [...groups.values()].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  return result;
}
