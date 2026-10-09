import type { GraphClientOptions } from './meta/graph';
import { InstagramPublicCollector } from './meta/business-discovery';
import { FacebookAdapter } from './meta/facebook';
import { InstagramAdapter } from './meta/instagram';
import { BlueskyPublicCollector } from './bluesky/public';
import { XPublicCollector } from './x/public';
import { YouTubePublicCollector } from './youtube/public';
import type { PrivateDataAdapter, PublicProfileCollector } from './types';

/**
 * Platforms with a live connector for owner-authorized (private) data. Every other platform gets data through CSV
 * import until its connector is built (docs/API_INTEGRATIONS.md §6).
 */
export const CONNECTED_PLATFORMS = ['instagram', 'facebook'] as const;

/** Which OAuth provider connects each platform. */
export const PROVIDER_FOR_PLATFORM: Record<string, 'meta'> = {
  instagram: 'meta',
  facebook: 'meta',
};

export function hasConnector(platformKey: string): boolean {
  return (CONNECTED_PLATFORMS as readonly string[]).includes(platformKey);
}

export function createAdapter(
  platformKey: string,
  options: GraphClientOptions = {},
): PrivateDataAdapter | null {
  switch (platformKey) {
    case 'instagram':
      return new InstagramAdapter(options);
    case 'facebook':
      return new FacebookAdapter(options);
    default:
      return null;
  }
}

/**
 * Platforms whose public profiles Scopie can read without the owner's authorization,
 * through an official API. Mirrors platforms.public_data_status = 'available'.
 */
export const PUBLIC_DATA_PLATFORMS = ['instagram', 'youtube', 'x', 'bluesky'] as const;

/**
 * Public platforms read through an organization's viewer account (Instagram). The others
 * use a server-wide API key (YouTube, X) or nothing at all (Bluesky), and need no
 * per-organization setup.
 */
export const VIEWER_PLATFORMS = ['instagram'] as const;

/** Public platforms that need no key and no viewer: always ready to read. */
export const KEYLESS_PUBLIC_PLATFORMS = ['bluesky'] as const;

/**
 * Public platforms that bill every item read (X). They get only the daily observation,
 * which reads new posts and re-reads posts due a snapshot; no refresh or backfill jobs.
 */
export const BILLED_PUBLIC_PLATFORMS = ['x'] as const;

export function needsViewer(platformKey: string): boolean {
  return (VIEWER_PLATFORMS as readonly string[]).includes(platformKey);
}

export function isKeylessPublic(platformKey: string): boolean {
  return (KEYLESS_PUBLIC_PLATFORMS as readonly string[]).includes(platformKey);
}

export function isBilledPublic(platformKey: string): boolean {
  return (BILLED_PUBLIC_PLATFORMS as readonly string[]).includes(platformKey);
}

export function hasPublicCollector(platformKey: string): boolean {
  return (PUBLIC_DATA_PLATFORMS as readonly string[]).includes(platformKey);
}

export function createPublicCollector(
  platformKey: string,
  options: GraphClientOptions = {},
): PublicProfileCollector | null {
  switch (platformKey) {
    case 'instagram':
      return new InstagramPublicCollector(options);
    case 'youtube':
      return new YouTubePublicCollector(options);
    case 'x':
      return new XPublicCollector(options);
    case 'bluesky':
      return new BlueskyPublicCollector(options);
    default:
      return null;
  }
}
