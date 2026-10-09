import Link from 'next/link';
import { changeLine, type Tile } from '@/lib/productivity/shared';

/** Number tiles in the style of the weekly report: value or N/A with why, comparison, basis. */
export function MetricTiles({
  tiles,
  comparisonLabel,
}: {
  tiles: Tile[];
  comparisonLabel: string | null;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => {
        const change = changeLine(tile, comparisonLabel);
        return (
          <li key={tile.key} className="bg-card min-w-0 space-y-1.5 rounded-lg border p-3 sm:p-4">
            <p className="text-muted-foreground text-xs font-medium">{tile.label}</p>
            {tile.value === null ? (
              <>
                <p className="text-muted-foreground text-xl font-semibold">N/A</p>
                <p className="text-muted-foreground text-xs italic">
                  {tile.unavailable || 'Not measurable for this period.'}
                </p>
              </>
            ) : (
              <p className="text-xl font-semibold tabular-nums">
                {tile.href ? (
                  <Link href={tile.href} className="hover:underline">
                    {tile.display}
                  </Link>
                ) : (
                  tile.display
                )}
              </p>
            )}
            {change ? <p className="text-muted-foreground text-xs tabular-nums">{change}</p> : null}
            <p className="text-muted-foreground border-t pt-1.5 text-[11px] leading-snug">
              {tile.basis}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/** A titled block of the page. */
export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 space-y-3">
      <div className="space-y-1">
        <h2 id={`${id}-title`} className="text-base font-semibold">
          {title}
        </h2>
        {description ? <p className="text-muted-foreground text-[13px]">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
