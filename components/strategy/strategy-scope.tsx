import { Globe, LayoutGrid } from 'lucide-react';
import type { Country, Platform } from '@/lib/accounts/queries';
import { scopeLabel } from '@/lib/strategy/shared';
import { cn } from '@/lib/utils';

/** Markets and platforms a strategy covers; empty lists read as "All". */
export function StrategyScope({
  countryCodes,
  platformKeys,
  countries,
  platforms,
  className,
}: {
  countryCodes: string[];
  platformKeys: string[];
  countries: Pick<Country, 'code' | 'name'>[];
  platforms: Pick<Platform, 'key' | 'name'>[];
  className?: string;
}) {
  const countryName = new Map(countries.map((c) => [c.code, c.name]));
  const platformName = new Map(platforms.map((p) => [p.key, p.name]));
  return (
    <dl className={cn('space-y-1 text-[13px]', className)}>
      <div className="flex items-start gap-2">
        <dt className="text-muted-foreground flex shrink-0 items-center gap-1.5">
          <Globe className="size-3.5" aria-hidden />
          <span className="sr-only">Markets</span>
        </dt>
        <dd className="min-w-0">
          {scopeLabel(countryCodes, (code) => countryName.get(code) ?? code, 'All markets')}
        </dd>
      </div>
      <div className="flex items-start gap-2">
        <dt className="text-muted-foreground flex shrink-0 items-center gap-1.5">
          <LayoutGrid className="size-3.5" aria-hidden />
          <span className="sr-only">Platforms</span>
        </dt>
        <dd className="min-w-0">
          {scopeLabel(platformKeys, (key) => platformName.get(key) ?? key, 'All platforms')}
        </dd>
      </div>
    </dl>
  );
}
