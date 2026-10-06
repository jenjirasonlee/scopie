import { z } from 'zod';

export const accountFiltersSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  platform: z.string().trim().max(30).optional().catch(undefined),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional()
    .catch(undefined),
  status: z.enum(['active', 'inactive', 'all']).catch('active').default('active'),
  group: z.enum(['none', 'country']).catch('country').default('country'),
});

export type AccountFilters = z.infer<typeof accountFiltersSchema>;

export function parseAccountFilters(
  params: Record<string, string | string[] | undefined>,
): AccountFilters {
  const single = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value || undefined;
  return accountFiltersSchema.parse({
    q: single(params.q),
    platform: single(params.platform),
    country: single(params.country),
    status: single(params.status),
    group: single(params.group),
  });
}
