import type { FormState } from '@/lib/forms';
import { INSTAGRAM_USERNAME, normalizeHandle } from '@/lib/platforms/meta/business-discovery';
import {
  YOUTUBE_CHANNEL_ID,
  YOUTUBE_HANDLE,
  normalizeYouTubeHandle,
} from '@/lib/platforms/youtube/public';

/** Platforms whose public profiles can be added by handle, and how to read a handle. */
export const PUBLIC_PROFILE_PLATFORMS = {
  instagram: {
    label: 'Instagram',
    normalize: normalizeHandle,
    isValid: (handle: string) => INSTAGRAM_USERNAME.test(handle),
    invalidMessage: 'Enter an Instagram username: letters, numbers, periods and underscores.',
    externalId: /^\d{1,30}$/,
    accountType: 'business',
  },
  youtube: {
    label: 'YouTube',
    normalize: normalizeYouTubeHandle,
    isValid: (handle: string) => YOUTUBE_HANDLE.test(handle) || YOUTUBE_CHANNEL_ID.test(handle),
    invalidMessage: 'Enter a YouTube handle such as @brandname, or a channel link.',
    externalId: YOUTUBE_CHANNEL_ID,
    accountType: 'channel',
  },
} as const;

export type PublicProfilePlatform = keyof typeof PUBLIC_PROFILE_PLATFORMS;

export function publicPlatform(value: string): PublicProfilePlatform {
  return value === 'youtube' ? 'youtube' : 'instagram';
}

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
export function parseHandleList(
  text: string,
  platform: PublicProfilePlatform = 'instagram',
): {
  handles: { handle: string; countryCode: string | null }[];
  invalid: string[];
} {
  const handles = new Map<string, string | null>();
  const invalid: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [first = '', second = ''] = line.split(/[,;\t]/).map((cell) => cell.trim());
    if (!first || /^(username|handle|instagram|youtube|channel)$/i.test(first)) continue;
    const rules = PUBLIC_PROFILE_PLATFORMS[platform];
    const handle = rules.normalize(first.replace(/^"|"$/g, ''));
    if (!rules.isValid(handle)) {
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
