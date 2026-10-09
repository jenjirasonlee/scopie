import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { platformName } from '@/lib/analytics/names';
import {
  calendarHref,
  CONTENT_STATUSES,
  hasFilters,
  STATUS_LABELS,
  toDateKey,
  type CalendarFilters as Filters,
  type CalendarView,
} from '@/lib/calendar/dates';

type Option = { value: string; label: string };

/** Narrow the calendar down. A plain GET form, so it works without JavaScript. */
export function CalendarFilters({
  orgSlug,
  view,
  date,
  today,
  filters,
  countries,
  platforms,
  owners,
  pillars,
  campaigns,
}: {
  orgSlug: string;
  view: CalendarView;
  date: Date;
  today: Date;
  filters: Filters;
  countries: Option[];
  platforms: string[];
  owners: Option[];
  pillars: Option[];
  campaigns: Option[];
}) {
  const fields: { name: keyof Filters; label: string; all: string; options: Option[] }[] = [
    { name: 'country', label: 'Country', all: 'All countries', options: countries },
    {
      name: 'platform',
      label: 'Platform',
      all: 'All platforms',
      options: platforms.map((key) => ({ value: key, label: platformName(key) })),
    },
    { name: 'owner', label: 'Owner', all: 'Anyone', options: owners },
    {
      name: 'status',
      label: 'Status',
      all: 'All but archived',
      options: CONTENT_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] })),
    },
    { name: 'pillar', label: 'Pillar', all: 'All pillars', options: pillars },
    { name: 'campaign', label: 'Campaign', all: 'All campaigns', options: campaigns },
  ];
  return (
    <form
      action={`/${orgSlug}/calendar`}
      className="bg-card grid grid-cols-2 items-end gap-3 rounded-lg border px-4 py-3 sm:grid-cols-3 lg:flex lg:flex-wrap"
      aria-label="Filter the calendar"
    >
      {view !== 'month' ? <input type="hidden" name="view" value={view} /> : null}
      {toDateKey(date) !== toDateKey(today) ? (
        <input type="hidden" name="date" value={toDateKey(date)} />
      ) : null}
      {fields.map((field) => (
        <div key={field.name} className="min-w-0 space-y-1 lg:w-40">
          <label
            htmlFor={`cal-${field.name}`}
            className="text-muted-foreground block text-xs font-medium"
          >
            {field.label}
          </label>
          <NativeSelect
            id={`cal-${field.name}`}
            name={field.name}
            defaultValue={filters[field.name] ?? ''}
          >
            <option value="">{field.all}</option>
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
        {hasFilters(filters) ? (
          <Button asChild variant="ghost">
            <Link href={calendarHref(orgSlug, { view, date, filters: {} }, today)}>Clear</Link>
          </Button>
        ) : null}
      </div>
    </form>
  );
}
