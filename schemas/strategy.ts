import { z } from 'zod';
import {
  MAX_PERIOD_DAYS,
  periodLength,
  STRATEGY_KPIS,
  STRATEGY_STATUSES,
} from '@/lib/strategy/shared';
import { optionalText } from './common';

const day = z.iso.date('Choose a date');

/** Name, summary, period and scope: the create form and the "Basics" edit form. */
export const strategyBasicsSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Give the strategy a name')
      .max(120, 'Use at most 120 characters'),
    summary: optionalText(2000),
    periodStart: day,
    periodEnd: day,
    countryCodes: z
      .array(
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{2}$/, 'Choose countries from the list'),
      )
      .max(60, 'Choose at most 60 markets, or none for all')
      .transform((codes) => [...new Set(codes)]),
    platformKeys: z
      .array(z.string().trim().min(1))
      .max(10)
      .transform((keys) => [...new Set(keys)]),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    path: ['periodEnd'],
    message: 'The end date can’t be before the start date',
  })
  .refine(
    (v) =>
      v.periodEnd < v.periodStart ||
      periodLength(v.periodStart, v.periodEnd) <= MAX_PERIOD_DAYS + 1,
    {
      path: ['periodEnd'],
      message: 'Keep the period to two years or less',
    },
  );

export type StrategyBasicsInput = z.infer<typeof strategyBasicsSchema>;

export const strategyToneSchema = z.object({ toneOfVoice: optionalText(2000) });

/** One priority per line; empty lines are ignored. */
export function parsePriorities(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
}

export const strategyPrioritiesSchema = z.object({
  priorities: z
    .string()
    .optional()
    .transform((text) => parsePriorities(text ?? ''))
    .pipe(
      z
        .array(z.string().max(200, 'Keep each priority under 200 characters'))
        .max(10, 'List at most 10 priorities'),
    ),
});

export const strategyStatusSchema = z.object({
  strategyId: z.uuid(),
  status: z.enum(STRATEGY_STATUSES),
});

export const deleteStrategySchema = z.object({
  strategyId: z.uuid(),
  confirm: z.literal('yes', 'Tick the box to confirm'),
});

/** A target typed in a form: empty means none. Commas are accepted as decimal points. */
const targetValue = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value.replace(',', '.') : ''))
  .refine((value) => value === '' || /^\d+(\.\d+)?$/.test(value), 'Enter a number, 0 or more')
  .transform((value) => (value === '' ? null : Number(value)))
  .refine((value) => value === null || value <= 1_000_000_000, 'Enter a smaller number');

export const objectiveSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Give the objective a name')
      .max(200, 'Use at most 200 characters'),
    description: optionalText(2000),
    kpi: z.enum(STRATEGY_KPIS, 'Choose how it is measured'),
    targetValue,
  })
  .refine((v) => v.kpi === 'manual' || v.targetValue !== null, {
    path: ['targetValue'],
    message: 'Set a target for this measure',
  });

export type ObjectiveInput = z.infer<typeof objectiveSchema>;

const share = z
  .string()
  .trim()
  .transform((value) => value.replace(',', '.').replace(/%$/, '').trim())
  .refine((value) => value === '' || /^\d+(\.\d+)?$/.test(value), 'Enter a percentage')
  .transform((value) => (value === '' ? 0 : Number(value)))
  .refine((value) => value <= 100, 'Use 100% or less');

/**
 * Pillar targets as a whole set, from fields named "share.<pillarId>". Empty or 0 means the
 * pillar has no target. The shares add up to at most 100%.
 */
export const pillarTargetsSchema = z
  .record(z.uuid(), share)
  .transform((shares) =>
    Object.entries(shares)
      .filter(([, value]) => value > 0)
      .map(([pillarId, targetShare]) => ({ pillarId, targetShare })),
  )
  .refine(
    (targets) => targets.reduce((sum, t) => sum + t.targetShare, 0) <= 100 + 1e-9,
    'The targets add up to more than 100%. Lower some of them.',
  );

export type PillarTargetInput = z.infer<typeof pillarTargetsSchema>;

/** Pillar shares from form fields named "share.<pillarId>". */
export function pillarSharesFrom(entries: Iterable<[string, FormDataEntryValue]>) {
  const shares: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (key.startsWith('share.') && typeof value === 'string') shares[key.slice(6)] = value;
  }
  return shares;
}

/** A set of chosen ids (audiences or competitors); none is fine. */
export const idSetSchema = z
  .array(z.uuid())
  .max(200)
  .transform((ids) => [...new Set(ids)]);
