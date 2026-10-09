import { z } from 'zod';
import { formatPeriod } from '@/lib/ai/shared';
import { formatDateTime } from '@/lib/content/review';
import { REPORT_SNAPSHOT_VERSION, type ReportSnapshot, type ReportWeek } from './types';

// Labels and small helpers for the weekly report pages and notifications. Safe to use in the
// browser. The snapshot is shown as stored; nothing here recomputes a number.

// ---------------------------------------------------------------------------
// Weeks and links
// ---------------------------------------------------------------------------

const DAY_MONTH = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * A report week (Monday and Sunday, as dates) in words: "29 Sept – 5 Oct 2026", or
 * "29 Dec 2025 – 4 Jan 2026" across years. Without the year: "29 Sept – 5 Oct".
 * Null when the dates can't be read.
 */
export function formatWeek(
  week: ReportWeek,
  { year = true }: { year?: boolean } = {},
): string | null {
  if (!isDay(week.start) || !isDay(week.end)) return null;
  const from = new Date(`${week.start}T00:00:00Z`);
  const to = new Date(`${week.end}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return null;
  if (!year) return `${DAY_MONTH.format(from)} – ${DAY_MONTH.format(to)}`;
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  return `${(sameYear ? DAY_MONTH : DAY_MONTH_YEAR).format(from)} – ${DAY_MONTH_YEAR.format(to)}`;
}

/** "29 Sept 2026": a single date (YYYY-MM-DD or an ISO timestamp) in the time zone given. */
export function formatDay(value: string, timeZone: string): string | null {
  const date = new Date(isDay(value) ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: isDay(value) ? 'UTC' : timeZone,
  }).format(date);
}

export function reportHref(orgSlug: string, reportId: string): string {
  return `/${orgSlug}/reports/${reportId}`;
}

/** The notification line for a new report: "Weekly report for 29 Sept – 5 Oct is ready". */
export function reportReadyText(week: ReportWeek | null): string {
  const period = week ? formatWeek(week, { year: false }) : null;
  return period ? `Weekly report for ${period} is ready` : 'A weekly report is ready';
}

/** "Made automatically on 6 Oct 2026, 06:00", "Made by Sam on …", in the time zone given. */
export function madeByLine(
  madeBy: 'schedule' | 'manual',
  createdByName: string | null,
  createdAt: string,
  timeZone: string,
): string {
  const when = formatDateTime(createdAt, timeZone);
  if (madeBy === 'schedule') return `Made automatically on ${when}`;
  return createdByName ? `Made by ${createdByName} on ${when}` : `Made on request on ${when}`;
}

/** Short form for the reports list: "Automatically" or the person's name. */
export function madeByShort(madeBy: 'schedule' | 'manual', createdByName: string | null): string {
  if (madeBy === 'schedule') return 'Automatically';
  return createdByName ?? 'On request (former member)';
}

export const RANKING_ROLE_LABELS: Record<'own' | 'competitor' | 'other', string> = {
  own: 'Own profile',
  competitor: 'Competitor',
  other: 'Other',
};

/** Who wrote the report's words, for its "Who wrote it" note. */
export function reportWriterSentences(
  analysis: ReportSnapshot['analysis'],
  timeZone: string,
): string[] {
  const summary =
    'The summary sentences are always written by Scopie’s own rules from the numbers.';
  if (!analysis) {
    return [
      'No analysis could be made for this week, so the report has no insights or recommended actions.',
      summary,
    ];
  }
  const period = formatPeriod(analysis.periodStart, analysis.periodEnd, timeZone);
  const of = period ? `the analysis of ${period}` : 'the latest analysis';
  const how =
    analysis.writer === 'model'
      ? `worded by the AI model ${analysis.model ?? '(name not recorded)'} and checked by Scopie against the numbers before saving`
      : 'written by Scopie’s own rules (no AI model)';
  return [`The insights and recommended actions come from ${of}, ${how}.`, summary];
}

// ---------------------------------------------------------------------------
// Reading a stored snapshot
// ---------------------------------------------------------------------------

/**
 * Keeps the items of a list that can be read and leaves out the rest, rather than showing
 * made-up values. Anything that isn't a list reads as empty.
 */
function listOf<T extends z.ZodType>(item: T) {
  return z.unknown().transform((value) =>
    Array.isArray(value)
      ? value.flatMap((entry) => {
          const parsed = item.safeParse(entry);
          return parsed.success ? [parsed.data as z.output<T>] : [];
        })
      : [],
  );
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const week = z.object({ start: day, end: day });
const nullableNumber = z.number().finite().nullable().catch(null);
const nullableString = z.string().nullable().catch(null);

const kpi = z.object({
  key: z.string(),
  label: z.string(),
  value: nullableNumber,
  display: z.string(),
  previous: nullableNumber,
  previousDisplay: z.string().catch(''),
  change: nullableString,
  basis: z.string().catch(''),
  unavailable: nullableString,
});

const ranking = z.object({
  platformKey: z.string(),
  platform: z.string(),
  basis: z.string().catch(''),
  rows: listOf(
    z.object({
      rank: z.number(),
      accountId: z.string(),
      name: z.string(),
      countryCode: nullableString,
      role: z.enum(['own', 'competitor', 'other']).catch('other'),
      display: z.string(),
      sample: z.string().catch(''),
    }),
  ),
  notRanked: listOf(z.object({ name: z.string(), reason: z.string() })),
});

const insight = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  severity: z.enum(['important', 'notable', 'info']),
});

const snapshotSchema = z.object({
  version: z.literal(REPORT_SNAPSHOT_VERSION),
  orgName: z.string(),
  isDemo: z.boolean(),
  dataSource: z.enum(['live_public', 'live_connected', 'imported', 'estimated', 'demo']),
  timeZone: z.string(),
  week,
  previousWeek: week,
  summary: listOf(z.string()),
  kpis: listOf(kpi),
  markets: listOf(ranking),
  competitors: listOf(ranking),
  topContent: listOf(
    z.object({
      accountId: z.string(),
      profile: z.string(),
      platform: z.string(),
      format: z.string(),
      publishedAt: z.string(),
      engagement: z.number(),
      display: z.string(),
      permalink: nullableString,
    }),
  ),
  strategies: listOf(
    z.object({
      id: z.string(),
      name: z.string(),
      objectives: listOf(z.object({ name: z.string(), display: z.string(), note: nullableString })),
      coverage: z.string().catch(''),
    }),
  ),
  insights: z
    .object({
      key: listOf(insight),
      opportunities: listOf(insight),
      risks: listOf(insight),
    })
    .catch({ key: [], opportunities: [], risks: [] }),
  actions: listOf(
    z.object({
      id: z.string(),
      title: z.string(),
      recommendation: z.string(),
      confidence: z.enum(['high', 'medium', 'low']),
    }),
  ),
  analysis: z
    .object({
      runId: z.string(),
      writer: z.enum(['rules', 'model']),
      model: nullableString,
      createdAt: z.string(),
      periodStart: z.string(),
      periodEnd: z.string(),
    })
    .nullable()
    .catch(null),
  notes: listOf(z.string()),
});

export type SnapshotResult =
  | { status: 'ok'; snapshot: ReportSnapshot }
  /** Made by a newer version of Scopie than this one can read. */
  | { status: 'newer' }
  | { status: 'unreadable' };

/** A stored snapshot (jsonb), checked before it is shown. */
export function readSnapshot(value: unknown): SnapshotResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { status: 'unreadable' };
  }
  const version = (value as { version?: unknown }).version;
  if (typeof version === 'number' && version > REPORT_SNAPSHOT_VERSION) return { status: 'newer' };
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) return { status: 'unreadable' };
  // Kinds and KPI keys are kept as stored, including ones this version doesn't know.
  return { status: 'ok', snapshot: parsed.data as ReportSnapshot };
}

/** Plain links only: a post link must be an http(s) URL. */
export function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
