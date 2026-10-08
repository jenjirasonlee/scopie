import { z } from 'zod';
import { optionalText } from './common';

/** Statuses a person can choose before review and approval exist (Phase 6). */
export const EDITABLE_STATUSES = ['IDEA', 'DRAFT'] as const;

const optionalId = z
  .union([z.uuid(), z.literal('')])
  .optional()
  .transform((value) => (value ? value : null));

/** "#grow, #hydro tips" → ["grow", "hydrotips"]: unique, without #, at most 60. */
export function parseHashtags(text: string): string[] {
  const tags = text
    .split(/[\s,]+/)
    .map((tag) => tag.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter(Boolean);
  return [...new Set(tags.map((tag) => tag.toLowerCase()))].slice(0, 60);
}

const plannedDate = z
  .string()
  .optional()
  .transform((value) => value ?? '')
  .refine((value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Use a date');

const plannedTime = z
  .string()
  .optional()
  .transform((value) => value ?? '')
  .refine((value) => value === '' || /^\d{2}:\d{2}$/.test(value), 'Use a time such as 09:30');

const timeNeedsDate = {
  path: ['plannedDate'],
  message: 'Choose a date for this time',
};

/**
 * The content item form. Planned date and time are entered in the organization's
 * time zone; the action converts them to a timestamp.
 */
export const contentItemSchema = z
  .object({
    title: z.string().trim().min(1, 'Give it a title').max(200, 'Use at most 200 characters'),
    status: z.enum(EDITABLE_STATUSES, { error: 'Choose idea or draft' }),
    platformKeys: z.array(z.string().min(1)).max(10),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .optional()
      .transform((value) => value ?? '')
      .refine((value) => value === '' || /^[A-Z]{2}$/.test(value), 'Choose a country')
      .transform((value) => (value === '' ? null : value)),
    ownerUserId: optionalId,
    pillarId: optionalId,
    contentFormatId: optionalId,
    campaignId: optionalId,
    audienceId: optionalId,
    ctaTypeId: optionalId,
    strategyObjectiveId: optionalId,
    plannedDate,
    plannedTime,
    description: optionalText(5000),
    caption: optionalText(5000),
    cta: optionalText(200),
    hashtags: z
      .string()
      .optional()
      .transform((value) => parseHashtags(value ?? '')),
    notes: optionalText(5000),
  })
  .refine((value) => value.plannedTime === '' || value.plannedDate !== '', timeNeedsDate);

export type ContentItemInput = z.infer<typeof contentItemSchema>;

/** Publish date and owner: what can still change once a version is locked for review. */
export const contentPlanSchema = z
  .object({ ownerUserId: optionalId, plannedDate, plannedTime })
  .refine((value) => value.plannedTime === '' || value.plannedDate !== '', timeNeedsDate);

export type ContentPlanInput = z.infer<typeof contentPlanSchema>;
