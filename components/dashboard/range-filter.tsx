import { Check } from 'lucide-react';
import Link from 'next/link';
import { platformName } from '@/lib/analytics/names';
import { RANGE_OPTIONS, type RangeDays } from '@/lib/analytics/range';
import { cn } from '@/lib/utils';

function dashboardHref(orgSlug: string, days: number, platform: string | null) {
  const query = new URLSearchParams({ range: String(days) });
  if (platform) query.set('platform', platform);
  return `/${orgSlug}/dashboard?${query}`;
}

function Segment({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      scroll={false}
      className={cn(
        'inline-flex items-center gap-1 rounded-[5px] px-2.5 py-1 text-xs font-medium',
        active
          ? 'bg-card text-foreground shadow-xs'
          : 'text-muted-foreground hover:bg-card/60 hover:text-foreground',
      )}
    >
      {active ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : null}
      {children}
    </Link>
  );
}

/** Date range presets. Scopes every number on the dashboard. */
export function RangeFilter({
  orgSlug,
  days,
  platform = null,
}: {
  orgSlug: string;
  days: RangeDays;
  platform?: string | null;
}) {
  return (
    <nav aria-label="Date range" className="bg-muted/60 inline-flex rounded-md border p-0.5">
      {RANGE_OPTIONS.map((option) => (
        <Segment
          key={option}
          href={dashboardHref(orgSlug, option, platform)}
          active={option === days}
        >
          Last {option} days
        </Segment>
      ))}
    </nav>
  );
}

/** One platform at a time: followers and engagement only compare within a platform. */
export function PlatformFilter({
  orgSlug,
  days,
  platforms,
  current,
}: {
  orgSlug: string;
  days: RangeDays;
  platforms: { key: string; profiles: number }[];
  current: string | null;
}) {
  if (platforms.length < 2) return null;
  return (
    <nav
      aria-label="Platform"
      className="bg-muted/60 inline-flex flex-wrap rounded-md border p-0.5"
    >
      {platforms.map((platform) => (
        <Segment
          key={platform.key}
          href={dashboardHref(orgSlug, days, platform.key)}
          active={platform.key === current}
        >
          {platformName(platform.key)}
        </Segment>
      ))}
    </nav>
  );
}
