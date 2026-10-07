import { Check } from 'lucide-react';
import Link from 'next/link';
import { RANGE_OPTIONS, type RangeDays } from '@/lib/analytics/range';
import { cn } from '@/lib/utils';

/** Date range presets. Scopes every number on the dashboard. */
export function RangeFilter({ orgSlug, days }: { orgSlug: string; days: RangeDays }) {
  return (
    <nav aria-label="Date range" className="bg-muted/60 inline-flex rounded-md border p-0.5">
      {RANGE_OPTIONS.map((option) => {
        const active = option === days;
        return (
          <Link
            key={option}
            href={`/${orgSlug}/dashboard?range=${option}`}
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
            Last {option} days
          </Link>
        );
      })}
    </nav>
  );
}
