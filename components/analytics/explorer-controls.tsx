import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { BUSINESS_ROLE_LABELS, DATA_SOURCE_LABELS } from '@/lib/accounts/labels';
import { MEDIA_FORMAT_LABELS } from '@/lib/analytics/content';
import { COMPARE_BY_LABELS, type ExplorerView } from '@/lib/analytics/explorer';
import { platformName } from '@/lib/analytics/names';
import { RANGE_OPTIONS, type RangeDays } from '@/lib/analytics/range';

type Option = { value: string; label: string };

/**
 * What to explore: period, filters, grouping and metric. A plain GET form, so it works
 * without JavaScript and every view has a shareable URL.
 */
export function ExplorerControls({
  orgSlug,
  days,
  view,
  countryNames,
  pillars,
  campaigns,
}: {
  orgSlug: string;
  days: RangeDays;
  view: ExplorerView;
  countryNames: Map<string, string>;
  pillars: { id: string; name: string }[];
  campaigns: { id: string; name: string }[];
}) {
  const { filters, options } = view;
  const fields: {
    name: string;
    label: string;
    value: string;
    all?: string;
    options: Option[];
  }[] = [
    {
      name: 'range',
      label: 'Period',
      value: String(days),
      options: RANGE_OPTIONS.map((option) => ({
        value: String(option),
        label: `Last ${option} days`,
      })),
    },
    {
      name: 'platform',
      label: 'Platform',
      value: view.platformParam,
      options: [
        { value: 'all', label: 'All platforms' },
        ...options.platforms.map((p) => ({
          value: p.key,
          label: `${platformName(p.key)} (${p.count})`,
        })),
      ],
    },
    {
      name: 'country',
      label: 'Country',
      value: filters.country ?? '',
      all: 'All countries',
      options: options.countries.map((c) => ({
        value: c.key,
        label: countryNames.get(c.key) ?? c.key,
      })),
    },
    {
      name: 'role',
      label: 'Profile role',
      value: filters.role ?? '',
      all: 'All roles',
      options: options.roles.map((r) => ({ value: r.key, label: BUSINESS_ROLE_LABELS[r.key] })),
    },
    {
      name: 'format',
      label: 'Format',
      value: filters.format ?? '',
      all: 'All formats',
      options: options.formats.map((f) => ({ value: f.key, label: MEDIA_FORMAT_LABELS[f.key] })),
    },
  ];
  if (pillars.length) {
    fields.push({
      name: 'pillar',
      label: 'Pillar',
      value: filters.pillar ?? '',
      all: 'All pillars',
      options: pillars.map((p) => ({ value: p.id, label: p.name })),
    });
  }
  if (campaigns.length) {
    fields.push({
      name: 'campaign',
      label: 'Campaign',
      value: filters.campaign ?? '',
      all: 'All campaigns',
      options: campaigns.map((c) => ({ value: c.id, label: c.name })),
    });
  }
  fields.push({
    name: 'compare',
    label: 'Compare by',
    value: view.compareBy,
    options: view.compareOptions.map((key) => ({ value: key, label: COMPARE_BY_LABELS[key] })),
  });
  if (view.metrics.length) {
    fields.push({
      name: 'metric',
      label: 'Metric',
      value: view.metricKey,
      options: view.metrics.map((m) => ({ value: m.key, label: m.label })),
    });
  }
  if (view.sources.length > 1) {
    fields.push({
      name: 'source',
      label: 'Data',
      value: view.source,
      options: view.sources.map((s) => ({ value: s, label: DATA_SOURCE_LABELS[s] })),
    });
  }

  return (
    <form
      action={`/${orgSlug}/analytics`}
      className="bg-card grid grid-cols-2 items-end gap-3 rounded-lg border px-4 py-3 sm:grid-cols-3 lg:flex lg:flex-wrap"
      aria-label="Choose which posts to explore"
    >
      {fields.map((field) => (
        <div key={field.name} className="min-w-0 space-y-1 lg:w-40">
          <label
            htmlFor={`an-${field.name}`}
            className="text-muted-foreground block text-xs font-medium"
          >
            {field.label}
          </label>
          <NativeSelect id={`an-${field.name}`} name={field.name} defaultValue={field.value}>
            {field.all ? <option value="">{field.all}</option> : null}
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      ))}
      <div className="col-span-full flex items-center gap-2 lg:col-auto">
        <Button type="submit" variant="outline">
          Show
        </Button>
        <Button asChild variant="ghost">
          <Link href={`/${orgSlug}/analytics`}>Reset</Link>
        </Button>
      </div>
    </form>
  );
}
