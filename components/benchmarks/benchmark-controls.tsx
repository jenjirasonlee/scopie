import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import {
  BENCHMARK_METRIC_INFO,
  BENCHMARK_METRICS,
  type BenchmarkMetric,
} from '@/lib/analytics/benchmark';
import { platformName } from '@/lib/analytics/names';
import { RANGE_OPTIONS, type RangeDays } from '@/lib/analytics/range';

/**
 * What to benchmark: metric, set of profiles, platform and period. A plain GET form, so it
 * works without JavaScript and every view has a shareable URL.
 */
export function BenchmarkControls({
  orgSlug,
  metric,
  set,
  platform,
  days,
  groups,
  platforms,
}: {
  orgSlug: string;
  metric: BenchmarkMetric;
  set: string;
  platform: string;
  days: RangeDays;
  groups: { id: string; name: string; members: number }[];
  platforms: { key: string; count: number }[];
}) {
  return (
    <form
      action={`/${orgSlug}/benchmarks`}
      className="bg-card flex flex-wrap items-end gap-3 rounded-lg border px-4 py-3"
      aria-label="Choose what to benchmark"
    >
      <Field label="Rank by" htmlFor="bm-metric" className="sm:w-64">
        <NativeSelect id="bm-metric" name="metric" defaultValue={metric}>
          {BENCHMARK_METRICS.map((key) => (
            <option key={key} value={key}>
              {BENCHMARK_METRIC_INFO[key].label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Profiles" htmlFor="bm-set" className="sm:w-56">
        <NativeSelect id="bm-set" name="set" defaultValue={set}>
          <option value="all">All monitored profiles</option>
          {groups.length ? (
            <optgroup label="Benchmark groups">
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name} ({group.members})
                </option>
              ))}
            </optgroup>
          ) : null}
        </NativeSelect>
      </Field>
      <Field label="Platform" htmlFor="bm-platform" className="sm:w-44">
        <NativeSelect id="bm-platform" name="platform" defaultValue={platform}>
          {platforms.map((p) => (
            <option key={p.key} value={p.key}>
              {platformName(p.key)} ({p.count})
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Period" htmlFor="bm-range" className="sm:w-40">
        <NativeSelect id="bm-range" name="range" defaultValue={String(days)}>
          {RANGE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              Last {option} days
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Button type="submit" variant="outline">
        Show
      </Button>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`w-full space-y-1 ${className ?? ''}`}>
      <label htmlFor={htmlFor} className="text-muted-foreground block text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}
