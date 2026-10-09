import 'server-only';
import { type ServerEnv, metaConfig, publicApiCredential } from '@/lib/server-env';
import type { PublicProfilePlatform } from './shared';

/**
 * What each public platform still needs on this server, in plain words, or null when it
 * is ready. Never includes a key, only whether one is set.
 */
export function publicDataSetup(
  env: ServerEnv,
  viewerChosen: boolean,
): Record<PublicProfilePlatform, string | null> {
  const missingKey = (platform: 'youtube' | 'x', name: string) =>
    publicApiCredential(env, platform) === null ? `${name} needs an API key on the server.` : null;
  return {
    instagram: !metaConfig(env)
      ? 'Instagram needs a Meta app on the server.'
      : viewerChosen
        ? null
        : 'Instagram needs a viewer account (see below).',
    youtube: missingKey('youtube', 'YouTube'),
    x: missingKey('x', 'X'),
    bluesky: null,
  };
}
