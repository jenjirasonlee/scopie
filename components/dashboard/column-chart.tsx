import { chartVars, Legend, niceTicks, seriesColor } from './chart-kit';

export type ColumnGroup = {
  key: string;
  label: string;
  /** null = no value for this series in this group (drawn as nothing, never as 0). */
  values: { key: string; value: number | null; tooltip: string }[];
};

const W = 640;
const H = 220;

/**
 * Server-rendered grouped column chart: columns at most 24px wide with a rounded data end,
 * square at the baseline, 2px apart. Missing values are left empty, not drawn as zero.
 */
export function ColumnChart({
  title,
  description,
  series,
  groups,
  formatY,
}: {
  title: string;
  description: string;
  series: { key: string; label: string; slot: number }[];
  groups: ColumnGroup[];
  formatY: (value: number) => string;
}) {
  const m = { top: 16, right: 8, bottom: 26, left: 40 };
  const innerW = W - m.left - m.right;
  const innerH = H - m.top - m.bottom;
  const values = groups.flatMap((g) =>
    g.values.flatMap((v) => (v.value === null ? [] : [v.value])),
  );
  const ticks = niceTicks(0, Math.max(1, ...values));
  const yMax = ticks[ticks.length - 1]!;
  const y = (value: number) => m.top + innerH - (value / yMax) * innerH;
  const band = innerW / Math.max(1, groups.length);
  const barW = Math.min(24, (band * 0.7 - 2 * (series.length - 1)) / series.length);
  const clusterW = barW * series.length + 2 * (series.length - 1);
  const labelValues = groups.length <= 4;
  const titleId = `chart-${title.replace(/\W+/g, '-').toLowerCase()}`;

  return (
    <figure className={`${chartVars} space-y-3`}>
      {series.length > 1 ? <Legend items={series} mark="square" /> : null}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-labelledby={`${titleId}-t ${titleId}-d`}
      >
        <title id={`${titleId}-t`}>{title}</title>
        <desc id={`${titleId}-d`}>{description}</desc>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={m.left}
              x2={W - m.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke={tick === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'}
              strokeWidth={1}
            />
            <text
              x={m.left - 8}
              y={y(tick)}
              dy="0.32em"
              textAnchor="end"
              className="fill-muted-foreground text-[11px] tabular-nums"
            >
              {formatY(tick)}
            </text>
          </g>
        ))}
        {groups.map((group, gi) => {
          const x0 = m.left + band * gi + (band - clusterW) / 2;
          const showLabel = groups.length <= 8 || gi % Math.ceil(groups.length / 6) === 0;
          return (
            <g key={group.key}>
              {group.values.map((v, si) => {
                const slot = series.findIndex((s) => s.key === v.key);
                const bx = x0 + si * (barW + 2);
                if (v.value === null) return null;
                const top = y(v.value);
                const height = y(0) - top;
                const r = Math.min(4, height, barW / 2);
                return (
                  <g key={v.key}>
                    {height > 0 ? (
                      <path
                        d={`M${bx},${y(0)}V${top + r}Q${bx},${top} ${bx + r},${top}H${bx + barW - r}Q${bx + barW},${top} ${bx + barW},${top + r}V${y(0)}Z`}
                        fill={seriesColor(series[slot]?.slot ?? slot)}
                      />
                    ) : null}
                    {labelValues ? (
                      <text
                        x={bx + barW / 2}
                        y={top - 4}
                        textAnchor="middle"
                        className="fill-foreground text-[10px] tabular-nums"
                      >
                        {formatY(v.value)}
                      </text>
                    ) : null}
                    <rect x={bx - 1} y={m.top} width={barW + 2} height={innerH} fill="transparent">
                      <title>{v.tooltip}</title>
                    </rect>
                  </g>
                );
              })}
              {showLabel ? (
                <text
                  x={m.left + band * gi + band / 2}
                  y={H - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[11px]"
                >
                  {group.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
