import type { GraphClientOptions } from './meta/graph';
import { InstagramPublicCollector } from './meta/business-discovery';
import { FacebookAdapter } from './meta/facebook';
import { InstagramAdapter } from './meta/instagram';
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
export const PUBLIC_DATA_PLATFORMS = ['instagram'] as const;

export function hasPublicCollector(platformKey: string): boolean {
  return (PUBLIC_DATA_PLATFORMS as readonly string[]).includes(platformKey);
}

export function createPublicCollector(
  platformKey: string,
  options: GraphClientOptions = {},
): PublicProfileCollector | null {
  return platformKey === 'instagram' ? new InstagramPublicCollector(options) : null;
}
