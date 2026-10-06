import { z } from 'zod';
import { isValidTimezone, optionalText } from './common';

export const ACCOUNT_TYPES = [
  { value: 'business', label: 'Business' },
  { value: 'creator', label: 'Creator' },
  { value: 'page', label: 'Page' },
  { value: 'company_page', label: 'Company page' },
  { value: 'channel', label: 'Channel' },
  { value: 'community', label: 'Community / server' },
  { value: 'personal', label: 'Personal' },
] as const;

const accountTypeValues = ACCOUNT_TYPES.map((type) => type.value) as [string, ...string[]];

/**
 * Fields a person may set on a social account. Connection status, data source
 * and sync time are intentionally absent: only the sync engine sets them.
 */
export const socialAccountSchema = z.object({
  // A disabled placeholder option isn't submitted, so a missing value must read as "choose" too.
  platformKey: z.string({ error: 'Choose a platform' }).min(1, 'Choose a platform'),
  displayName: z.string().trim().min(1, 'Enter the account name').max(120),
  handle: optionalText(120).transform((value) => (value ? value.replace(/^@/, '') : null)),
  externalId: optionalText(120),
  accountType: z
    .union([z.enum(accountTypeValues), z.literal('')])
    .transform((value) => (value === '' ? null : value)),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => value === '' || /^[A-Z]{2}$/.test(value), 'Choose a country')
    .transform((value) => (value === '' ? null : value)),
  language: optionalText(35).refine(
    (value) => value === null || /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value),
    'Use a language code such as en, de or pt-BR',
  ),
  timezone: optionalText(64).refine(
    (value) => value === null || isValidTimezone(value),
    'Unknown timezone',
  ),
  ownerUserId: z
    .union([z.uuid(), z.literal('')])
    .transform((value) => (value === '' ? null : value)),
  isCompetitor: z
    .union([z.literal('on'), z.literal('true'), z.literal('false'), z.literal('')])
    .optional()
    .transform((value) => value === 'on' || value === 'true'),
  notes: optionalText(2000),
});

export type SocialAccountInput = z.input<typeof socialAccountSchema>;
export type SocialAccountValues = z.output<typeof socialAccountSchema>;

export function toSocialAccountRow(values: SocialAccountValues) {
  return {
    platform_key: values.platformKey,
    display_name: values.displayName,
    handle: values.handle,
    external_id: values.externalId,
    account_type: values.accountType,
    country_code: values.countryCode,
    language: values.language,
    timezone: values.timezone,
    owner_user_id: values.ownerUserId,
    is_competitor: values.isCompetitor,
    notes: values.notes,
  };
}
