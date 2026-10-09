import { CalendarDays, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PlatformMark } from '@/components/accounts/platform-mark';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { can } from '@/lib/auth/permissions';
import { utcToZonedParts } from '@/lib/calendar/time';
import { getContentOptionLists } from '@/lib/content/form-options';
import { countContentItems, listContentItems } from '@/lib/content/queries';
import {
  CONTENT_STATUS_LABELS,
  CONTENT_STATUS_VARIANT,
  CONTENT_STATUSES,
  parseContentFilters,
} from '@/lib/content/shared';
import { getOrgContext } from '@/lib/orgs/queries';
import { pillarColorClass } from '@/lib/taxonomy/shared';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Content' };

export default async function ContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug }, search] = await Promise.all([params, searchParams]);
  const filters = parseContentFilters(search);
  const { org, role } = await getOrgContext(orgSlug);
  const canEdit = can(role, 'content.edit');
  const [items, total, options] = await Promise.all([
    listContentItems(org.id, filters),
    countContentItems(org.id),
    getContentOptionLists(org.id),
  ]);
  const platformName = new Map(options.platforms.map((p) => [p.value, p.label]));
  const countryName = new Map(options.countries.map((c) => [c.value, c.label]));
  const isFiltered = Boolean(
    filters.q ||
    filters.status ||
    filters.platform ||
    filters.country ||
    filters.pillar ||
    filters.campaign ||
    filters.owner ||
    filters.archived,
  );
  const when = (iso: string) => {
    const { date, time } = utcToZonedParts(new Date(iso), org.default_timezone);
    return `${new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })}, ${time}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Content"
        description={
          org.is_demo
            ? `${org.name}. Everything below is DEMO DATA generated for testing; none of it is real.`
            : 'Ideas and drafts with their copy, files and plan. Every version is kept.'
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/${orgSlug}/calendar`}>
                <CalendarDays aria-hidden />
                Calendar
              </Link>
            </Button>
            {canEdit ? (
              <Button asChild>
                <Link href={`/${orgSlug}/content/new`}>
                  <Plus aria-hidden />
                  New content
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {total === 0 ? (
        <div className="bg-card rounded-lg border border-dashed px-6 py-12 text-center">
          <p className="font-medium">No content yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-[13px]">
            Start with an idea: a title is enough. Add the copy, files, platforms and a publish date
            when you have them, and it shows up on the calendar.
          </p>
          {canEdit ? (
            <Button asChild className="mt-4">
              <Link href={`/${orgSlug}/content/new`}>Add your first idea</Link>
            </Button>
          ) : (
            <p className="text-muted-foreground mt-3 text-xs">
              Editors, managers, admins and owners can add content.
            </p>
          )}
        </div>
      ) : (
        <>
          <form
            className="flex flex-wrap items-end gap-2"
            role="search"
            aria-label="Filter content"
          >
            <div className="w-full sm:w-56">
              <label htmlFor="q" className="sr-only">
                Search
              </label>
              <Input id="q" name="q" placeholder="Search titles" defaultValue={filters.q} />
            </div>
            <Filter
              name="status"
              label="Stage"
              value={filters.status}
              allLabel="All stages"
              options={CONTENT_STATUSES.map((s) => ({ value: s, label: CONTENT_STATUS_LABELS[s] }))}
            />
            <Filter
              name="platform"
              label="Platform"
              value={filters.platform}
              allLabel="All platforms"
              options={options.platforms}
            />
            <Filter
              name="country"
              label="Country"
              value={filters.country}
              allLabel="All countries"
              options={options.countries}
            />
            <Filter
              name="pillar"
              label="Pillar"
              value={filters.pillar}
              allLabel="All pillars"
              options={options.pillars}
            />
            <Filter
              name="campaign"
              label="Campaign"
              value={filters.campaign}
              allLabel="All campaigns"
              options={options.campaigns}
            />
            <Filter
              name="owner"
              label="Owner"
              value={filters.owner}
              allLabel="All owners"
              options={options.members}
            />
            <label className="text-muted-foreground flex items-center gap-2 self-center text-[13px]">
              <input
                type="checkbox"
                name="archived"
                value="1"
                defaultChecked={filters.archived}
                className="accent-primary size-4"
              />
              Show archived
            </label>
            <Button type="submit" variant="outline">
              Apply
            </Button>
            {isFiltered ? (
              <Button asChild variant="ghost">
                <Link href={`/${orgSlug}/content`}>Reset</Link>
              </Button>
            ) : null}
            <p className="text-muted-foreground ml-auto self-center text-xs tabular-nums">
              {items.length} {items.length === 1 ? 'item' : 'items'}
            </p>
          </form>

          {items.length === 0 ? (
            <p className="text-muted-foreground bg-card rounded-lg border border-dashed px-6 py-10 text-center text-[13px]">
              Nothing matches these filters.
            </p>
          ) : (
            <div className="bg-card overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Platforms</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead>Pillar</TableHead>
                    <TableHead>Publish</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead className="text-right">Files</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow
                      key={item.id}
                      className={item.status === 'ARCHIVED' ? 'text-muted-foreground' : undefined}
                    >
                      <TableCell className="max-w-72">
                        <Link
                          href={`/${orgSlug}/content/${item.id}`}
                          className="text-foreground font-medium hover:underline"
                        >
                          {item.title}
                        </Link>
                        <span className="text-muted-foreground block text-xs">
                          {item.campaign?.name ?? 'No campaign'}
                          {item.versionNumber && item.versionNumber > 1
                            ? ` · version ${item.versionNumber}`
                            : ''}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={CONTENT_STATUS_VARIANT[item.status]}>
                          {CONTENT_STATUS_LABELS[item.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap gap-1">
                          {item.platformKeys.length
                            ? item.platformKeys.map((key) => (
                                <span key={key} title={platformName.get(key) ?? key}>
                                  <PlatformMark platformKey={key} />
                                </span>
                              ))
                            : '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        {item.countryCode
                          ? (countryName.get(item.countryCode) ?? item.countryCode)
                          : 'All'}
                      </TableCell>
                      <TableCell>
                        {item.pillar ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              aria-hidden
                              className={cn(
                                'size-2 rounded-full',
                                pillarColorClass(item.pillar.color),
                              )}
                            />
                            {item.pillar.name}
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {item.publishedAt
                          ? `Published ${when(item.publishedAt)}`
                          : item.plannedPublishAt
                            ? when(item.plannedPublishAt)
                            : 'Not planned'}
                      </TableCell>
                      <TableCell>{item.owner?.name ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{item.assetCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-muted-foreground text-xs">Times in {org.default_timezone}.</p>
        </>
      )}
    </div>
  );
}

function Filter({
  name,
  label,
  value,
  options,
  allLabel,
}: {
  name: string;
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  return (
    <div className="w-[calc(50%-0.25rem)] sm:w-40">
      <label htmlFor={`filter-${name}`} className="sr-only">
        {label}
      </label>
      <NativeSelect id={`filter-${name}`} name={name} defaultValue={value ?? ''}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
