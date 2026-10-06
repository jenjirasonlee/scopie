import { z } from 'zod';
import { isValidTimezone } from './common';

export const profileSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter your name').max(120),
  timezone: z
    .string()
    .trim()
    .refine((value) => value === '' || isValidTimezone(value), 'Unknown timezone')
    .transform((value) => (value === '' ? null : value)),
});
