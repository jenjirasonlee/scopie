import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { formatPeriod, profileNames } from '@/lib/ai/shared';
import type { Evidence } from '@/lib/ai/types';

/**
 * The stored numbers an insight or recommendation rests on, in a fold. Every row says what
 * the number is, its value, how many posts or items it's based on (when that applies),
 * the period, how it was worked out and which profiles it covers.
 */
export function EvidenceFold({
  evidence,
  names,
  timeZone,
  link = null,
}: {
  evidence: Evidence[];
  names: ReadonlyMap<string, string>;
  timeZone: string;
  /** Page where the data behind it can be seen. */
  link?: string | null;
}) {
  return (
    <details className="text-[13px]">
      <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-xs font-medium select-none">
        Evidence ({evidence.length} {evidence.length === 1 ? 'number' : 'numbers'})
      </summary>
      <div className="mt-2 space-y-2">
        {evidence.length === 0 ? (
          <p className="text-muted-foreground text-xs">The evidence for this could not be read.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {evidence.map((row) => {
              const period = formatPeriod(row.periodStart, row.periodEnd, timeZone);
              const profiles = profileNames(row.accountIds, names);
              return (
                <li key={row.id} className="space-y-1 px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                    <span className="font-medium">{row.label}</span>
                    <span className="font-semibold tabular-nums">{row.display}</span>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {[
                      row.n !== undefined ? `Sample size ${row.n.toLocaleString('en-GB')}` : null,
                      period,
                      profiles.length ? profiles.join(', ') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {row.method ? (
                    <p className="text-muted-foreground text-xs">How: {row.method}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {link ? (
          <Link
            href={link}
            className="text-primary inline-flex items-center gap-0.5 text-xs font-medium hover:underline"
          >
            See the data in Scopie
            <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        ) : null}
      </div>
    </details>
  );
}

/** Link to the data behind the first of the signals that has a page, if any. */
export function signalLink(
  orgSlug: string,
  signalIds: readonly string[],
  paths: ReadonlyMap<string, string> | undefined,
): string | null {
  const path = signalIds.map((id) => paths?.get(id)).find(Boolean);
  return path ? `/${orgSlug}${path}` : null;
}
