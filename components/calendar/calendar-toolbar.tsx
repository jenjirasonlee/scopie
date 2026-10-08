import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  calendarHref,
  CALENDAR_VIEWS,
  formatRangeTitle,
  shiftDate,
  type CalendarFilters,
  type CalendarView,
} from '@/lib/calendar/dates';
import { cn } from '@/lib/utils';

const VIEW_LABELS: Record<CalendarView, string> = { month: 'Month', week: 'Week', list: 'List' };

/** Period title, previous / today / next, and the view switcher. */
export function CalendarToolbar({
  orgSlug,
  view,
  date,
  today,
  filters,
  timeZone,
}: {
  orgSlug: string;
  view: CalendarView;
  date: Date;
  today: Date;
  filters: CalendarFilters;
  timeZone: string;
}) {
  const href = (next: { view?: CalendarView; date?: Date }) =>
    calendarHref(orgSlug, { view: next.view ?? view, date: next.date, filters }, today);
  const unit = view === 'week' ? 'week' : 'month';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button asChild size="icon" variant="outline" className="size-8">
            <Link href={href({ date: shiftDate(view, date, -1) })} aria-label={`Previous ${unit}`}>
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={href({})}>Today</Link>
          </Button>
          <Button asChild size="icon" variant="outline" className="size-8">
            <Link href={href({ date: shiftDate(view, date, 1) })} aria-label={`Next ${unit}`}>
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        </div>
        <h2 className="text-base font-semibold">{formatRangeTitle(view, date)}</h2>
        <span className="text-muted-foreground text-xs">Times in {timeZone}</span>
      </div>
      <nav aria-label="Calendar view" className="bg-muted/60 inline-flex rounded-md border p-0.5">
        {CALENDAR_VIEWS.map((option) => {
          const active = option === view;
          return (
            <Link
              key={option}
              href={href({ view: option, date })}
              aria-current={active ? 'page' : undefined}
              scroll={false}
              className={cn(
                'inline-flex items-center gap-1 rounded-[5px] px-2.5 py-1 text-xs font-medium',
                active
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-card/60 hover:text-foreground',
              )}
            >
              {active ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : null}
              {VIEW_LABELS[option]}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
