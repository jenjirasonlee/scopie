import { describe, expect, it } from 'vitest';
import {
  activeFirst,
  campaignDates,
  isTaxonomyKind,
  PILLAR_COLORS,
  pillarColorClass,
  TAXONOMY,
  TAXONOMY_KINDS,
  taxonomyKindFromSlug,
  taxonomySchema,
  type TaxonomyItem,
} from '@/lib/taxonomy/shared';

function item(name: string, isActive = true): TaxonomyItem {
  return { id: name, name, description: null, isActive, createdAt: '2026-10-01T00:00:00Z' };
}

describe('taxonomy kinds', () => {
  it('map to their tables and tab links', () => {
    expect(TAXONOMY_KINDS.map((kind) => TAXONOMY[kind].table)).toEqual([
      'content_pillars',
      'content_formats',
      'campaigns',
      'audiences',
      'cta_types',
    ]);
    expect(taxonomyKindFromSlug('cta-types')).toBe('ctaTypes');
    expect(taxonomyKindFromSlug('campaigns')).toBe('campaigns');
    expect(taxonomyKindFromSlug(undefined)).toBe('pillars');
    expect(taxonomyKindFromSlug('nonsense')).toBe('pillars');
    expect(isTaxonomyKind('audiences')).toBe(true);
    expect(isTaxonomyKind('content_pillars')).toBe(false);
  });
});

describe('taxonomy item validation', () => {
  it('trims the name and turns an empty description into null', () => {
    const result = taxonomySchema('formats').parse({ name: '  Reels ', description: '  ' });
    expect(result).toEqual({ name: 'Reels', description: null });
  });

  it('requires a name of at most 80 characters and a description of at most 500', () => {
    const schema = taxonomySchema('audiences');
    expect(schema.safeParse({ name: '   ' }).success).toBe(false);
    expect(schema.safeParse({ name: 'a'.repeat(81) }).success).toBe(false);
    expect(schema.safeParse({ name: 'a'.repeat(80) }).success).toBe(true);
    expect(schema.safeParse({ name: 'Growers', description: 'x'.repeat(501) }).success).toBe(false);
  });

  it('accepts a pillar colour from the palette or none', () => {
    const schema = taxonomySchema('pillars');
    expect(schema.parse({ name: 'Guides', color: 'teal' }).color).toBe('teal');
    expect(schema.parse({ name: 'Guides', color: '' }).color).toBeNull();
    expect(schema.parse({ name: 'Guides' }).color).toBeNull();
    expect(schema.safeParse({ name: 'Guides', color: 'magenta' }).success).toBe(false);
  });

  it('ignores fields that belong to other kinds', () => {
    const result = taxonomySchema('formats').parse({ name: 'Reels', color: 'red' });
    expect(result).not.toHaveProperty('color');
  });

  it('allows open-ended campaigns but not an end before the start', () => {
    const schema = taxonomySchema('campaigns');
    expect(schema.parse({ name: 'Spring', startsOn: '', endsOn: '' })).toMatchObject({
      startsOn: null,
      endsOn: null,
    });
    expect(schema.parse({ name: 'Spring', startsOn: '2026-03-01' }).startsOn).toBe('2026-03-01');
    expect(
      schema.safeParse({ name: 'Spring', startsOn: '2026-03-01', endsOn: '2026-03-01' }).success,
    ).toBe(true);
    const backwards = schema.safeParse({
      name: 'Spring',
      startsOn: '2026-03-10',
      endsOn: '2026-03-01',
    });
    expect(backwards.success).toBe(false);
    expect(backwards.error?.issues[0]?.path).toEqual(['endsOn']);
    expect(schema.safeParse({ name: 'Spring', startsOn: '2026-02-30' }).success).toBe(false);
  });
});

describe('taxonomy helpers', () => {
  it('gives every pillar colour a swatch class and a fallback for none', () => {
    for (const color of PILLAR_COLORS) expect(pillarColorClass(color)).toMatch(/^bg-/);
    expect(pillarColorClass(null)).toContain('border-dashed');
    expect(pillarColorClass('magenta')).toContain('border-dashed');
  });

  it('sorts active items first, then by name ignoring case', () => {
    const sorted = [item('b'), item('A', false), item('c'), item('a')].sort(activeFirst);
    expect(sorted.map((i) => `${i.name}${i.isActive ? '' : '*'}`)).toEqual(['a', 'b', 'c', 'A*']);
  });

  it('describes campaign dates', () => {
    expect(campaignDates({ startsOn: '2026-03-01', endsOn: '2026-03-31' })).toBe(
      '1 Mar 2026 to 31 Mar 2026',
    );
    expect(campaignDates({ startsOn: '2026-03-01', endsOn: null })).toBe('From 1 Mar 2026');
    expect(campaignDates({ startsOn: null, endsOn: '2026-03-31' })).toBe('Until 31 Mar 2026');
    expect(campaignDates({ startsOn: null, endsOn: null })).toBeNull();
  });
});
