import { PlatformMark } from '@/components/accounts/platform-mark';
import { Badge } from '@/components/ui/badge';
import { publicDataUnavailableReason } from '@/lib/public-data/shared';

type PlatformRow = { key: string; name: string; public_data_status: string };

/** How each platform with public data is read, in plain words. */
const HOW: Record<string, string> = {
  instagram: 'Business and creator accounts, through your viewer account.',
  youtube: 'Any public channel.',
  x: 'Any public account that isn’t protected. X bills each read, so Scopie reads only new posts and recent ones.',
  bluesky: 'Any public account. No key needed.',
};

/**
 * For every platform: whether Scopie can read other accounts' public numbers (competitors)
 * and, if not, why. CSV import works for all of them.
 */
export function PlatformCapabilities({
  platforms,
  setup,
}: {
  platforms: PlatformRow[];
  /** Per platform with public data: what the server still needs, or null when ready. */
  setup: Record<string, string | null>;
}) {
  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-lg border">
        {platforms.map((platform) => {
          const available = platform.public_data_status === 'available';
          const gap = available ? (setup[platform.key] ?? null) : null;
          return (
            <li key={platform.key} className="flex flex-wrap items-start gap-3 p-3 text-[13px]">
              <PlatformMark platformKey={platform.key} className="mt-0.5" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{platform.name}</span>
                  {!available ? (
                    <Badge variant="muted">Not available</Badge>
                  ) : gap ? (
                    <Badge variant="warning">Setup needed</Badge>
                  ) : (
                    <Badge variant="success">Available</Badge>
                  )}
                </div>
                <p className="text-muted-foreground">
                  {available
                    ? `${HOW[platform.key] ?? 'Public profiles can be added by handle.'}${gap ? ` ${gap}` : ''}`
                    : publicDataUnavailableReason(platform.key)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground text-[13px]">
        CSV import works for every platform, including those without public data.
      </p>
    </div>
  );
}
