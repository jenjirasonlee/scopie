import type { GraphClientOptions } from './meta/graph';
import { FacebookAdapter } from './meta/facebook';
import { InstagramAdapter } from './meta/instagram';
import type { PlatformAdapter } from './types';

/**
 * Platforms with a live API connector. Every other platform gets data through CSV
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
): PlatformAdapter | null {
  switch (platformKey) {
    case 'instagram':
      return new InstagramAdapter(options);
    case 'facebook':
      return new FacebookAdapter(options);
    default:
      return null;
  }
}
