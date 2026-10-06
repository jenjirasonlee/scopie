import { describe, expect, it } from 'vitest';
import { isValidSlug, slugify } from '@/lib/orgs/slug';

describe('organization slugs', () => {
  it('turns names into URL-safe slugs', () => {
    expect(slugify('CANNA Corporate')).toBe('canna-corporate');
    expect(slugify('  Café Münster & Co. ')).toBe('cafe-munster-co');
    expect(slugify('---')).toBe('');
  });

  it('caps slugs at 48 characters without a trailing dash', () => {
    const slug = slugify('a'.repeat(47) + ' b');
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('rejects reserved words and malformed slugs', () => {
    expect(isValidSlug('canna')).toBe(true);
    expect(isValidSlug('canna-de')).toBe(true);
    expect(isValidSlug('sign-in')).toBe(false);
    expect(isValidSlug('onboarding')).toBe(false);
    expect(isValidSlug('-canna')).toBe(false);
    expect(isValidSlug('Canna')).toBe(false);
    expect(isValidSlug('canna_de')).toBe(false);
  });
});
