import { z } from 'zod';
import { isValidSlug } from '@/lib/orgs/slug';
import { timezoneSchema } from './common';

export const organizationSchema = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters').max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .refine(isValidSlug, 'Use lowercase letters, numbers and dashes (not a reserved word)'),
  defaultTimezone: timezoneSchema,
});

export const organizationSettingsSchema = organizationSchema.pick({
  name: true,
  defaultTimezone: true,
});

export type OrganizationInput = z.infer<typeof organizationSchema>;
