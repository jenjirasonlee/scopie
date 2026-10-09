import type { FormState } from '@/lib/forms';
import { INSTAGRAM_USERNAME, normalizeHandle } from '@/lib/platforms/meta/business-discovery';

/** Add-profile previews per organization per hour. Syncs use the rest of Meta's limit. */
export const LOOKUPS_PER_HOUR = 30;

export const BUSINESS_ROLE_VALUES = [
  'owned',
  'competitor',
  'industry',
  'influencer',
  'other',
] as const;

/** What the viewer account could read for a username. Public fields only. */
export type ProfilePreview = {
  externalId: string;
  username: string;
  displayName: string | null;
  biography: string | null;
  website: string | null;
  followers: number | null;
  postsTotal: number | null;
};

export type LookupState = FormState & { handle?: string; preview?: ProfilePreview };

/**
 * Reads usernames from pasted text or a CSV. One profile per line; an optional second
 * column is a two-letter country code. A header row (username, handle) is skipped.
 */
export function parseHandleList(text: string): {
  handles: { handle: string; countryCode: string | null }[];
  invalid: string[];
} {
  const handles = new Map<string, string | null>();
  const invalid: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [first = '', second = ''] = line.split(/[,;\t]/).map((cell) => cell.trim());
    if (!first || /^(username|handle|instagram)$/i.test(first)) continue;
    const handle = normalizeHandle(first.replace(/^"|"$/g, ''));
    if (!INSTAGRAM_USERNAME.test(handle)) {
      invalid.push(first);
      continue;
    }
    const country = second.replace(/^"|"$/g, '').toUpperCase();
    if (!handles.has(handle.toLowerCase())) {
      handles.set(handle.toLowerCase(), /^[A-Z]{2}$/.test(country) ? country : null);
    }
  }
  return {
    handles: [...handles].map(([handle, countryCode]) => ({ handle, countryCode })),
    invalid,
  };
}
