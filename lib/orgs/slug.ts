// Organization slugs appear at the root of the URL (/{slug}/dashboard), so they
// must not collide with top-level routes.
export const RESERVED_SLUGS = new Set([
  'api',
  'app',
  'auth',
  'sign-in',
  'sign-up',
  'sign-out',
  'onboarding',
  'settings',
  'account',
  'admin',
  'docs',
  'help',
  'static',
  '_next',
]);

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !RESERVED_SLUGS.has(slug);
}
