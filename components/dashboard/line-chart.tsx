import { formatDay } from '@/lib/analytics/range';
import { chartVars, Legend, niceTicks, seriesColor } from './chart-kit';

export type LineSeries = {
  key: string;
  label: string;
  slot: number;
  points: { at: string; y: number; tooltip: string }[];
};

const W = 640;
const H = 240;
const GAP_MS = 1.5 * 86_400_000;

/**
 * Server-rendered line chart. Lines break where observations are missing (more than a day
 * and a half apart), so a gap is never drawn as a straight line or a zero. Each point has a
 * native tooltip; the caller supplies a table view.
 */
export function LineChart({
  title,
  description,
  series,
  domain,
  formatY,
}: {
  title: string;
  description: string;
  series: LineSeries[];
  domain: { start: Date; end: Date };
  formatY: (value: number) => string;
}) {
  const directLabels = series.length <= 4;
  const m = { top: 12, right: directLabels ? 132 : 16, bottom: 26, left: 52 };
  const innerW = W - m.left - m.right;
  const innerH = H - m.top - m.bottom;
  const values = series.flatMap((s) => s.points.map((p) => p.y));
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const yMin = ticks[0]!;
  const yMax = ticks[ticks.length - 1]!;
  const t0 = domain.start.getTime();
  const t1 = domain.end.getTime();
  const x = (at: string) => m.left + ((Date.parse(at) - t0) / (t1 - t0)) * innerW;
  const y = (value: number) => m.top + innerH - ((value - yMin) / (yMax - yMin || 1)) * innerH;

  const xTicks = Array.from({ length: 5 }, (_, i) => new Date(t0 + ((t1 - t0) * i) / 4));

  // End labels, nudged apart so they never overlap.
  const ends = series
    .filter((s) => s.points.length)
    .map((s) => {
      const last = s.points[s.points.length - 1]!;
      return { key: s.key, label: s.label, value: last.y, y: y(last.y), x: x(last.at) };
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) {
    ends[i]!.y = Math.max(ends[i]!.y, ends[i - 1]!.y + 13);
  }

  const titleId = `chart-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <figure className={`${chartVars} space-y-3`}>
      {series.length > 1 ? (
        <Legend
          items={series.map((s) => ({ key: s.key, label: s.label, slot: s.slot }))}
          mark="line"
        />
      ) : null}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full overflow-visible"
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
        {xTicks.map((tick, i) => (
          <text
            key={tick.toISOString()}
            x={m.left + (innerW * i) / 4}
            y={H - 6}
            textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}
            className="fill-muted-foreground text-[11px]"
          >
            {formatDay(tick)}
          </text>
        ))}
        {series.map((s) => {
          let d = '';
          s.points.forEach((p, i) => {
            const prev = s.points[i - 1];
            const jump = !prev || Date.parse(p.at) - Date.parse(prev.at) > GAP_MS;
            d += `${jump ? 'M' : 'L'}${x(p.at).toFixed(1)},${y(p.y).toFixed(1)}`;
          });
          const last = s.points[s.points.length - 1];
          return (
            <g key={s.key}>
              <path
                d={d}
                fill="none"
                stroke={seriesColor(s.slot)}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* Lone points (between gaps) would be invisible as a path, so draw them. */}
              {s.points.map((p, i) => {
                const prev = s.points[i - 1];
                const next = s.points[i + 1];
                const alone =
                  (!prev || Date.parse(p.at) - Date.parse(prev.at) > GAP_MS) &&
                  (!next || Date.parse(next.at) - Date.parse(p.at) > GAP_MS);
                return alone ? (
                  <circle key={p.at} cx={x(p.at)} cy={y(p.y)} r={3} fill={seriesColor(s.slot)} />
                ) : null;
              })}
              {last ? (
                <circle
                  cx={x(last.at)}
                  cy={y(last.y)}
                  r={4}
                  fill={seriesColor(s.slot)}
                  stroke="var(--chart-surface)"
                  strokeWidth={2}
                />
              ) : null}
              {s.points.map((p) => (
                <circle key={`hit-${p.at}`} cx={x(p.at)} cy={y(p.y)} r={12} fill="transparent">
                  <title>{p.tooltip}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {directLabels
          ? ends.map((end) => (
              <text
                key={end.key}
                x={end.x + 8}
                y={end.y}
                dy="0.32em"
                className="fill-foreground text-[11px]"
              >
                <tspan className="font-medium">{formatY(end.value)}</tspan>
                <tspan className="fill-muted-foreground"> {truncate(end.label, 16)}</tspan>
              </text>
            ))
          : null}
      </svg>
    </figure>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
