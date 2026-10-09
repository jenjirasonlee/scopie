import type { FormState } from '@/lib/forms';
import {
  BLUESKY_DID,
  isBlueskyHandle,
  normalizeBlueskyHandle,
} from '@/lib/platforms/bluesky/public';
import { INSTAGRAM_USERNAME, normalizeHandle } from '@/lib/platforms/meta/business-discovery';
import { X_USER_ID, X_USERNAME, normalizeXHandle } from '@/lib/platforms/x/public';
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
  x: {
    label: 'X',
    normalize: normalizeXHandle,
    isValid: (handle: string) => X_USERNAME.test(handle),
    invalidMessage:
      'Enter an X username such as @brandname (up to 15 letters, numbers or _), or a profile link.',
    externalId: X_USER_ID,
    accountType: 'profile',
  },
  bluesky: {
    label: 'Bluesky',
    normalize: normalizeBlueskyHandle,
    isValid: isBlueskyHandle,
    invalidMessage:
      'Enter a Bluesky handle such as brand.bsky.social or brand.com, or a profile link.',
    externalId: BLUESKY_DID,
    accountType: 'profile',
  },
} as const;

export type PublicProfilePlatform = keyof typeof PUBLIC_PROFILE_PLATFORMS;

export const PUBLIC_PROFILE_PLATFORM_KEYS = Object.keys(
  PUBLIC_PROFILE_PLATFORMS,
) as PublicProfilePlatform[];

export function publicPlatform(value: string): PublicProfilePlatform {
  return value in PUBLIC_PROFILE_PLATFORMS ? (value as PublicProfilePlatform) : 'instagram';
}

/**
 * Why Scopie can't read other accounts' public numbers on a platform, in plain words for
 * the capability list. CSV import works for every platform. Platforms that can be read
 * (platforms.public_data_status = 'available') have no entry.
 */
export const PUBLIC_DATA_UNAVAILABLE_REASONS: Record<string, string> = {
  facebook:
    'Needs Meta’s approval for Page Public Content Access and a verified business. Not set up in Scopie.',
  linkedin: 'Needs LinkedIn’s approval as a partner. There is no general way to read other pages.',
  threads: 'Needs Meta’s approval to read other accounts. Not available to Scopie yet.',
  tiktok: 'TikTok has no official way to read other accounts’ public numbers.',
  pinterest: 'Pinterest has no official way to read other accounts’ public numbers.',
  reddit: 'Using Reddit’s data commercially needs Reddit’s written approval.',
  discord: 'Discord has no official way to read other servers’ numbers.',
};

/** The plain reason a platform's public data can't be read, or a general one. */
export function publicDataUnavailableReason(platformKey: string): string {
  return (
    PUBLIC_DATA_UNAVAILABLE_REASONS[platformKey] ??
    'There is no official way for Scopie to read other accounts’ numbers here yet.'
  );
}

/**
 * Add-profile previews per organization per hour. Syncs use the rest of Meta's limit, and
 * each X preview is billed (about $0.01).
 */
export const LOOKUPS_PER_HOUR = 30;

/**
 * Platforms whose official API can find profiles by name with the credential Scopie has.
 * Instagram (Business Discovery) and X (app-only token) only read an exact username.
 */
export const SEARCHABLE_PLATFORMS = ['youtube', 'bluesky'] as const;
export type SearchablePlatform = (typeof SEARCHABLE_PLATFORMS)[number];
export function isSearchable(platform: string): platform is SearchablePlatform {
  return (SEARCHABLE_PLATFORMS as readonly string[]).includes(platform);
}

/** A YouTube search costs 100 of the 10,000 daily quota units, so it gets its own daily cap. */
export const YOUTUBE_SEARCHES_PER_DAY = 40;

/** A profile found by name. Public fields only. */
export type SearchHit = {
  externalId: string;
  username: string;
  displayName: string | null;
  profilePictureUrl: string | null;
  followers: number | null;
};

export type SearchResult =
  | { status: 'success'; query: string; hits: SearchHit[] }
  | { status: 'error'; query: string; message: string };

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
    if (!first || /^(username|handle|instagram|youtube|channel|x|twitter|bluesky)$/i.test(first))
      continue;
    const rules = PUBLIC_PROFILE_PLATFORMS[platform];
    const handle: string = rules.normalize(first.replace(/^"|"$/g, ''));
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
