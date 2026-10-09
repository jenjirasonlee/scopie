import { z } from 'zod';
import { formatDate } from '@/lib/analytics/range';

/**
 * The content taxonomy: the lists an organization tags its content and posts with, so they
 * can be compared and planned. Shared by the server and client components (no server-only code).
 */
export const TAXONOMY_KINDS = ['pillars', 'formats', 'campaigns', 'audiences', 'ctaTypes'] as const;
export type TaxonomyKind = (typeof TAXONOMY_KINDS)[number];

export type TaxonomyTable =
  'content_pillars' | 'content_formats' | 'campaigns' | 'audiences' | 'cta_types';

export const TAXONOMY: Record<
  TaxonomyKind,
  {
    table: TaxonomyTable;
    /** URL value for the settings tab. */
    slug: string;
    label: string;
    singular: string;
    plural: string;
    description: string;
    placeholder: string;
  }
> = {
  pillars: {
    table: 'content_pillars',
    slug: 'pillars',
    label: 'Content pillars',
    singular: 'pillar',
    plural: 'pillars',
    description: 'The main themes you post about. Give each a colour to spot it in the calendar.',
    placeholder: 'e.g. Grow guides',
  },
  formats: {
    table: 'content_formats',
    slug: 'formats',
    label: 'Formats',
    singular: 'format',
    plural: 'formats',
    description: 'The kinds of content you make.',
    placeholder: 'e.g. Short video',
  },
  campaigns: {
    table: 'campaigns',
    slug: 'campaigns',
    label: 'Campaigns',
    singular: 'campaign',
    plural: 'campaigns',
    description: 'Time-bound pushes that group content together. Dates are optional.',
    placeholder: 'e.g. Spring launch',
  },
  audiences: {
    table: 'audiences',
    slug: 'audiences',
    label: 'Audiences',
    singular: 'audience',
    plural: 'audiences',
    description: 'The groups of people your content is meant for.',
    placeholder: 'e.g. Home growers',
  },
  ctaTypes: {
    table: 'cta_types',
    slug: 'cta-types',
    label: 'CTA types',
    singular: 'CTA type',
    plural: 'CTA types',
    description: 'What you ask people to do at the end of a post (the call to action).',
    placeholder: 'e.g. Visit the shop',
  },
};

export function isTaxonomyKind(value: unknown): value is TaxonomyKind {
  return typeof value === 'string' && (TAXONOMY_KINDS as readonly string[]).includes(value);
}

/** The tab named by a URL value; the first tab when it is missing or unknown. */
export function taxonomyKindFromSlug(slug: string | undefined): TaxonomyKind {
  return TAXONOMY_KINDS.find((kind) => TAXONOMY[kind].slug === slug) ?? TAXONOMY_KINDS[0];
}

// Mirrors the content_pillars_color check in supabase/migrations/…_content_hub.sql.
export const PILLAR_COLORS = [
  'green',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
  'red',
  'orange',
  'amber',
  'gray',
] as const;
export type PillarColor = (typeof PILLAR_COLORS)[number];

export const PILLAR_COLOR_LABELS: Record<PillarColor, string> = {
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  indigo: 'Indigo',
  purple: 'Purple',
  pink: 'Pink',
  red: 'Red',
  orange: 'Orange',
  amber: 'Amber',
  gray: 'Gray',
};

// Full class names written out so Tailwind finds them.
const PILLAR_COLOR_CLASSES: Record<PillarColor, string> = {
  green: 'bg-green-500',
  teal: 'bg-teal-500',
  blue: 'bg-blue-500',
  indigo: 'bg-indigo-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-400',
  gray: 'bg-gray-400',
};

/** Background class for a pillar's swatch or dot; an outlined empty dot when it has no colour. */
export function pillarColorClass(color: string | null | undefined): string {
  return isPillarColor(color)
    ? PILLAR_COLOR_CLASSES[color]
    : 'bg-transparent border border-dashed border-muted-foreground/50';
}

export function isPillarColor(value: unknown): value is PillarColor {
  return typeof value === 'string' && (PILLAR_COLORS as readonly string[]).includes(value);
}

export type TaxonomyItem = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
};
export type Pillar = TaxonomyItem & { color: PillarColor | null };
export type Campaign = TaxonomyItem & { startsOn: string | null; endsOn: string | null };

export type Taxonomy = {
  pillars: Pillar[];
  formats: TaxonomyItem[];
  campaigns: Campaign[];
  audiences: TaxonomyItem[];
  ctaTypes: TaxonomyItem[];
};

/** Case-insensitive by name. */
export function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/** Active items first, then by name. */
export function activeFirst(a: TaxonomyItem, b: TaxonomyItem): number {
  return Number(b.isActive) - Number(a.isActive) || byName(a, b);
}

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((value) => value || null);

const optionalDate = z
  .union([z.literal(''), z.iso.date('Enter a valid date')])
  .optional()
  .transform((value) => value || null);

const baseSchema = z.object({
  name: z.string().trim().min(1, 'Give it a name').max(80, 'Use at most 80 characters'),
  description: optionalText(500, 'Use at most 500 characters'),
});

const pillarSchema = baseSchema.extend({
  color: z
    .union([z.literal(''), z.enum(PILLAR_COLORS, 'Choose a colour from the list')])
    .optional()
    .transform((value) => value || null),
});

const campaignSchema = baseSchema
  .extend({ startsOn: optionalDate, endsOn: optionalDate })
  .refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, {
    message: 'The end date can’t be before the start date',
    path: ['endsOn'],
  });

export type TaxonomyInput = {
  name: string;
  description: string | null;
  color?: PillarColor | null;
  startsOn?: string | null;
  endsOn?: string | null;
};

/** Validation for an item's form fields. Pillars also take a colour; campaigns take dates. */
export function taxonomySchema(kind: TaxonomyKind): z.ZodType<TaxonomyInput, unknown> {
  if (kind === 'pillars') return pillarSchema;
  if (kind === 'campaigns') return campaignSchema;
  return baseSchema;
}

/** A campaign's dates for display, e.g. "1 Mar 2026 to 31 Mar 2026"; null when it has none. */
export function campaignDates(campaign: Pick<Campaign, 'startsOn' | 'endsOn'>): string | null {
  const { startsOn, endsOn } = campaign;
  if (startsOn && endsOn) return `${formatDate(startsOn)} to ${formatDate(endsOn)}`;
  if (startsOn) return `From ${formatDate(startsOn)}`;
  if (endsOn) return `Until ${formatDate(endsOn)}`;
  return null;
}
