import { z } from 'zod';
import { ValidationError } from '../errors';

/** Validates a Graph response; unexpected shapes become ValidationError, never defaults. */
export function parseGraph<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(
      `Unexpected ${what} response: ${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim(),
    );
  }
  return result.data;
}

export const pagingSchema = z
  .object({
    cursors: z.object({ after: z.string().optional() }).optional(),
    next: z.string().optional(),
  })
  .optional();

/** Next-page cursor, only when Meta says there is a next page. */
export function nextCursor(paging: z.infer<typeof pagingSchema>): string | null {
  return paging?.next && paging.cursors?.after ? paging.cursors.after : null;
}

/**
 * Meta reports a daily value with the end of that day as `end_time`
 * (midnight in Meta's reporting timezone, Pacific). Stepping back 12 hours lands
 * inside the reported day in both PST and PDT.
 */
export function metaReportDate(endTime: string): string {
  const instant = Date.parse(endTime);
  if (Number.isNaN(instant)) throw new ValidationError(`Invalid end_time "${endTime}"`);
  return new Date(instant - 12 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Unix seconds for a YYYY-MM-DD date at 00:00 UTC, as Meta's since/until expect. */
export function unixDay(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function eachDay(since: string, until: string): string[] {
  const days: string[] = [];
  for (let day = since; day <= until; day = addDays(day, 1)) days.push(day);
  return days;
}

export const insightValueSchema = z.object({
  value: z.union([z.number(), z.record(z.string(), z.number())]).optional(),
  end_time: z.string().optional(),
});

export const insightSchema = z.object({
  name: z.string(),
  period: z.string().optional(),
  values: z.array(insightValueSchema).optional(),
  total_value: z.object({ value: z.number() }).optional(),
});

export const insightsResponseSchema = z.object({ data: z.array(insightSchema) });

export type Insight = z.infer<typeof insightSchema>;

/** A single numeric value from an insight, or null when Meta returned none. */
export function singleInsightValue(insight: Insight): number | null {
  if (insight.total_value) return insight.total_value.value;
  const value = insight.values?.[0]?.value;
  return typeof value === 'number' ? value : null;
}
