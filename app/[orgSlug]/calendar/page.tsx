import { CalendarDays, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDnd } from '@/components/calendar/calendar-dnd';
import { CalendarFilters } from '@/components/calendar/calendar-filters';
import { CalendarToolbar } from '@/components/calendar/calendar-toolbar';
import { ItemChip } from '@/components/calendar/item-chip';
import { ItemPanel } from '@/components/calendar/item-panel';
import { ListView, MonthView, WeekView, type RenderChip } from '@/components/calendar/views';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { listCountries, listPlatforms } from '@/lib/accounts/queries';
import { can } from '@/lib/auth/permissions';
import {
  calendarHref,
  canReschedule,
  groupByDay,
  instantRange,
  parseCalendarParams,
  rangeFor,
  todayIn,
} from '@/lib/calendar/dates';
import {
  getCalendarItem,
  hasAnyContent,
  loadCalendar,
  loadFilterOptions,
} from '@/lib/calendar/queries';
import { safeTimeZone } from '@/lib/calendar/time';
import { listMembers } from '@/lib/members/queries';
import { getOrgContext } from '@/lib/orgs/queries';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Calendar' };

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ orgSlug }, search] = await Promise.all([params, searchParams]);
  const { org, role } = await getOrgContext(orgSlug);
  const canEdit = can(role, 'content.edit');
  const timeZone = safeTimeZone(org.default_timezone);
  // getOrgContext has already read request data, so the current time is per request.
  const today = todayIn(new Date(), timeZone);
  const { view, date, filters, item: itemId } = parseCalendarParams(search, today);
  const range = instantRange(rangeFor(view, date), timeZone);

  const [anyContent, calendar, selected, options, countries, platforms, members] =
    await Promise.all([
      hasAnyContent(org.id),
      loadCalendar(org.id, range, filters, { unscheduled: view === 'list' }),
      itemId ? getCalendarItem(org.id, itemId) : null,
      loadFilterOptions(org.id),
      listCountries(),
      listPlatforms(),
      listMembers(org.id),
    ]);
  const countryNames = new Map(countries.map((c) => [c.code, c.name]));

  const header = (
    <PageHeader
      title="Calendar"
      description={
        org.is_demo
          ? `${org.name}. Everything below is DEMO DATA generated for testing; none of it is real.`
          : 'Your planned and published content by day. Click an item to see its details.'
      }
      actions={
        canEdit ? (
          <Button asChild size="sm">
            <Link href={`/${orgSlug}/content/new`}>
              <Plus aria-hidden />
              New content
            </Link>
          </Button>
        ) : null
      }
    />
  );

  if (!anyContent) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <CalendarDays className="text-muted-foreground mx-auto size-8" aria-hidden />
            <h2 className="text-base font-semibold">Nothing on the calendar yet</h2>
            <p className="text-muted-foreground mx-auto max-w-lg text-[13px]">
              The calendar shows your content on the day it’s planned or was published, by month,
              week or as a list. Give a piece of content a planned date and it appears here; drag it
              to another day to move it.
            </p>
            {canEdit ? (
              <Button asChild size="sm">
                <Link href={`/${orgSlug}/content/new`}>Create content</Link>
              </Button>
            ) : (
              <p className="text-muted-foreground text-xs">
                Editors, managers, admins and owners can create content.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const hrefWith = (item?: string) => calendarHref(orgSlug, { view, date, filters, item }, today);
  const chip: RenderChip = (entry, chipOptions) => (
    <ItemChip
      item={entry}
      href={hrefWith(entry.id)}
      timeZone={timeZone}
      movable={canEdit && canReschedule(entry)}
      selected={entry.id === itemId}
      {...chipOptions}
    />
  );
  const byDay = groupByDay(calendar.items, timeZone);
  const viewProps = { date, today, byDay, droppable: canEdit, chip };
  const emptyText = view === 'week' ? 'Nothing planned this week.' : 'Nothing planned this month.';
  const calendarBody =
    view === 'list' ? (
      <ListView
        today={today}
        byDay={byDay}
        unscheduled={calendar.unscheduled}
        chip={chip}
        emptyText={emptyText}
      />
    ) : view === 'week' ? (
      <WeekView {...viewProps} />
    ) : (
      <>
        {/* A month grid is too cramped on a phone, so small screens get the month as a list. */}
        <div className="hidden md:block">
          <MonthView
            {...viewProps}
            addHref={
              canEdit
                ? (key) => `/${orgSlug}/content/new?date=${encodeURIComponent(key)}`
                : undefined
            }
          />
        </div>
        <div className="md:hidden">
          <ListView today={today} byDay={byDay} chip={chip} emptyText={emptyText} />
        </div>
      </>
    );

  return (
    <div className="space-y-5">
      {header}

      <CalendarFilters
        orgSlug={orgSlug}
        view={view}
        date={date}
        today={today}
        filters={filters}
        countries={options.countryCodes.map((code) => ({
          value: code,
          label: countryNames.get(code) ?? code,
        }))}
        platforms={platforms.map((p) => p.key)}
        owners={members.map((m) => ({ value: m.userId, label: m.fullName || m.email }))}
        pillars={options.pillars.map((p) => ({ value: p.id, label: p.name }))}
        campaigns={options.campaigns.map((c) => ({ value: c.id, label: c.name }))}
      />

      <CalendarToolbar
        orgSlug={orgSlug}
        view={view}
        date={date}
        today={today}
        filters={filters}
        timeZone={timeZone}
      />

      {canEdit && view !== 'list' ? (
        <CalendarDnd orgSlug={orgSlug}>{calendarBody}</CalendarDnd>
      ) : (
        calendarBody
      )}

      {canEdit && view !== 'list' ? (
        <p className={cn('text-muted-foreground text-xs', view === 'month' && 'hidden md:block')}>
          Drag an item to another day to move it. It keeps its time. Published and archived content
          stays put.
        </p>
      ) : null}

      {selected ? (
        <ItemPanel
          orgSlug={orgSlug}
          item={selected}
          closeHref={hrefWith()}
          timeZone={timeZone}
          countryName={
            selected.countryCode ? (countryNames.get(selected.countryCode) ?? null) : null
          }
          canEdit={canEdit}
          isDemo={org.is_demo}
        />
      ) : null}
    </div>
  );
}
