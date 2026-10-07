import { cn } from '@/lib/utils';

/**
 * Categorical chart colours (validated for colour-blind separation in both themes; three
 * light-mode slots sit below 3:1 contrast, so every chart ships a table view). Slots are
 * assigned in this fixed order and never cycled; charts cap their series count at 6.
 */
export const SERIES_SLOTS = 6;

export const chartVars = cn(
  '[--series-1:#2a78d6] [--series-2:#eb6834] [--series-3:#1baf7a] [--series-4:#eda100] [--series-5:#e87ba4] [--series-6:#008300]',
  'dark:[--series-1:#3987e5] dark:[--series-2:#d95926] dark:[--series-3:#199e70] dark:[--series-4:#c98500] dark:[--series-5:#d55181] dark:[--series-6:#008300]',
  '[--chart-grid:#e1e0d9] [--chart-axis:#c3c2b7] [--chart-surface:var(--card)] dark:[--chart-grid:#2c2c2a] dark:[--chart-axis:#383835]',
);

export function seriesColor(slot: number): string {
  return `var(--series-${(slot % SERIES_SLOTS) + 1})`;
}

/** Round tick values covering [min, max], always including zero when the data crosses it. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 2; value += step) {
    ticks.push(Math.round(value / step) * step);
  }
  return ticks;
}

/** Legend that mirrors the mark: a short line for line charts, a square for bars. */
export function Legend({
  items,
  mark,
}: {
  items: { key: string; label: string; slot: number }[];
  mark: 'line' | 'square';
}) {
  return (
    <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          {mark === 'line' ? (
            <span
              aria-hidden
              className="inline-block h-0.5 w-3.5 rounded-full"
              style={{ background: seriesColor(item.slot) }}
            />
          ) : (
            <span
              aria-hidden
              className="inline-block size-2.5 rounded-[3px]"
              style={{ background: seriesColor(item.slot) }}
            />
          )}
          <span className="text-foreground">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Every chart has its numbers in a plain table too. */
export function ChartTable({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group text-xs">
      <summary className="text-primary w-fit cursor-pointer font-medium hover:underline">
        {summary}
      </summary>
      <div className="mt-2 max-w-full overflow-x-auto">{children}</div>
    </details>
  );
}
