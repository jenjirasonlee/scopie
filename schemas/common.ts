import { z } from 'zod';

export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z.string().trim().min(1).refine(isValidTimezone, 'Unknown timezone');

/** Empty form fields become null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional()
    .transform((value) => value ?? null);
