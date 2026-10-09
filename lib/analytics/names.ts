import type { ProfileRecord } from './types';

export const PLATFORM_NAMES: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  x: 'X',
  bluesky: 'Bluesky',
  threads: 'Threads',
  pinterest: 'Pinterest',
  reddit: 'Reddit',
  discord: 'Discord',
};

export function platformName(key: string): string {
  return PLATFORM_NAMES[key] ?? key;
}

/**
 * Display names that tell profiles apart: one brand on several platforms shares a name, so
 * those get the platform added ("CANNA NL (Instagram)").
 */
export function distinctNames(
  profiles: readonly Pick<ProfileRecord, 'id' | 'name' | 'platformKey'>[],
) {
  const count = new Map<string, number>();
  for (const p of profiles) count.set(p.name, (count.get(p.name) ?? 0) + 1);
  return new Map(
    profiles.map((p) => [
      p.id,
      (count.get(p.name) ?? 0) > 1 ? `${p.name} (${platformName(p.platformKey)})` : p.name,
    ]),
  );
}
