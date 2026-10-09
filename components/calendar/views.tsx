import { Plus } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  addDays,
  formatWeekday,
  formatWeekdayShort,
  formatDayShort,
  monthGrid,
  toDateKey,
  weekRange,
} from '@/lib/calendar/dates';
import type { CalendarItem } from '@/lib/calendar/queries';
import { cn } from '@/lib/utils';

export type RenderChip = (
  item: CalendarItem,
  options?: { layout?: 'compact' | 'row'; showTime?: boolean },
) => ReactNode;

type ViewProps = {
  date: Date;
  today: Date;
  byDay: Map<string, CalendarItem[]>;
  /** Cells accept dropped items (editors only). */
  droppable: boolean;
  chip: RenderChip;
};

const DROP_ACTIVE =
  'data-[drop-active=true]:bg-primary/10 data-[drop-active=true]:ring-primary/40 data-[drop-active=true]:ring-2 data-[drop-active=true]:ring-inset';

/** A month as a grid of weeks, Monday first. */
export function MonthView({
  date,
  today,
  byDay,
  droppable,
  chip,
  addHref,
}: ViewProps & { addHref?: (dateKey: string) => string }) {
  const weeks = monthGrid(date);
  const month = date.getUTCMonth();
  const todayKey = toDateKey(today);
  return (
    <div className="bg-card overflow-hidden rounded-lg border">
      <div className="bg-muted/40 text-muted-foreground grid grid-cols-7 border-b text-xs font-medium">
        {(weeks[0] ?? []).map((day) => (
          <div key={day.getTime()} className="px-2 py-1.5">
            {formatWeekdayShort(day)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((day, index) => {
          const key = toDateKey(day);
          const items = byDay.get(key) ?? [];
          const outside = day.getUTCMonth() !== month;
          return (
            <div
              key={key}
              data-drop-date={droppable ? key : undefined}
              className={cn(
                'group min-h-28 min-w-0 space-y-1 border-b p-1.5',
                index % 7 !== 6 && 'border-r',
                index >= weeks.length * 7 - 7 && 'border-b-0',
                outside && 'bg-muted/30',
                DROP_ACTIVE,
              )}
            >
              <div className="flex items-center justify-between">
                <DayNumber day={day} isToday={key === todayKey} muted={outside} />
                {addHref ? (
                  <Link
                    href={addHref(key)}
                    aria-label={`Add content on ${formatWeekday(day)}`}
                    className="text-muted-foreground hover:bg-secondary hover:text-foreground rounded-sm p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Plus className="size-3.5" aria-hidden />
                  </Link>
                ) : null}
              </div>
              {items.map((item) => (
                <div key={item.id}>{chip(item)}</div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One week, Monday to Sunday, items in time order. Columns stack on small screens. */
export function WeekView({ date, today, byDay, droppable, chip }: ViewProps) {
  const { start } = weekRange(date);
  const todayKey = toDateKey(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="bg-card grid overflow-hidden rounded-lg border md:grid-cols-7">
      {days.map((day, index) => {
        const key = toDateKey(day);
        const items = byDay.get(key) ?? [];
        return (
          <div
            key={key}
            data-drop-date={droppable ? key : undefined}
            className={cn(
              'flex min-h-24 min-w-0 flex-col md:min-h-96',
              index < 6 && 'border-b md:border-r md:border-b-0',
              DROP_ACTIVE,
            )}
          >
            <div
              className={cn(
                'flex items-baseline gap-1.5 border-b px-2 py-1.5 text-xs font-medium',
                key === todayKey
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted/40 text-muted-foreground',
              )}
            >
              <time dateTime={key}>
                {formatWeekdayShort(day)} {formatDayShort(day)}
              </time>
              {key === todayKey ? <span className="ml-auto">Today</span> : null}
            </div>
            <div className="flex-1 space-y-1 p-1.5">
              {items.map((item) => (
                <div key={item.id}>{chip(item, { showTime: true })}</div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Items grouped by day, then (optionally) the ones with no date yet. */
export function ListView({
  today,
  byDay,
  unscheduled,
  chip,
  emptyText,
}: {
  today: Date;
  byDay: Map<string, CalendarItem[]>;
  unscheduled?: CalendarItem[];
  chip: RenderChip;
  emptyText: string;
}) {
  const todayKey = toDateKey(today);
  const days = [...byDay.keys()].sort();
  if (!days.length && !unscheduled?.length) {
    return (
      <p className="bg-card text-muted-foreground rounded-lg border px-4 py-8 text-center text-[13px]">
        {emptyText}
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {days.map((key) => (
        <section key={key} aria-labelledby={`day-${key}`} className="space-y-1.5">
          <h3 id={`day-${key}`} className="flex items-center gap-2 text-[13px] font-semibold">
            <time dateTime={key}>{formatWeekday(new Date(`${key}T00:00:00.000Z`))}</time>
            {key === todayKey ? (
              <span className="text-primary text-xs font-medium">Today</span>
            ) : null}
          </h3>
          <div className="space-y-1.5">
            {byDay.get(key)!.map((item) => (
              <div key={item.id}>{chip(item, { layout: 'row' })}</div>
            ))}
          </div>
        </section>
      ))}
      {unscheduled?.length ? (
        <section aria-labelledby="day-unscheduled" className="space-y-1.5">
          <h3 id="day-unscheduled" className="text-[13px] font-semibold">
            Unscheduled{' '}
            <span className="text-muted-foreground font-normal">({unscheduled.length})</span>
          </h3>
          <p className="text-muted-foreground text-xs">No publish date yet.</p>
          <div className="space-y-1.5">
            {unscheduled.map((item) => (
              <div key={item.id}>{chip(item, { layout: 'row' })}</div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function DayNumber({ day, isToday, muted }: { day: Date; isToday: boolean; muted: boolean }) {
  return (
    <time
      dateTime={toDateKey(day)}
      aria-label={formatWeekday(day)}
      className={cn(
        'inline-flex size-6 items-center justify-center rounded-full text-xs font-medium',
        isToday && 'bg-primary text-primary-foreground',
        !isToday && muted && 'text-muted-foreground',
      )}
    >
      {day.getUTCDate()}
    </time>
  );
}
