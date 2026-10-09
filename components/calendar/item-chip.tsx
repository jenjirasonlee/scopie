import Link from 'next/link';
import { PlatformMark } from '@/components/accounts/platform-mark';
import { STATUS_LABELS, timeIn } from '@/lib/calendar/dates';
import type { CalendarItem } from '@/lib/calendar/queries';
import { pillarColorClass } from '@/lib/taxonomy/shared';
import { cn } from '@/lib/utils';
import { StatusBadge } from './status-badge';

/**
 * One content item on the calendar. Opens the side panel; `movable` marks it for the drag
 * and drop enhancement (the drag itself is wired up by CalendarDnd).
 */
export function ItemChip({
  item,
  href,
  timeZone,
  movable,
  selected,
  layout = 'compact',
  showTime = false,
}: {
  item: CalendarItem;
  href: string;
  timeZone: string;
  movable: boolean;
  selected: boolean;
  layout?: 'compact' | 'row';
  /** Show the time on a compact chip (the week view). */
  showTime?: boolean;
}) {
  const time = item.at ? timeIn(item.at, timeZone) : null;
  const dot = (
    <span
      aria-hidden
      className={cn('size-2 shrink-0 rounded-full', pillarColorClass(item.pillar?.color))}
    />
  );
  return (
    <Link
      href={href}
      scroll={false}
      draggable={movable}
      data-move-item={movable ? item.id : undefined}
      aria-current={selected ? 'true' : undefined}
      title={`${item.title} · ${STATUS_LABELS[item.status]}${time ? ` · ${time}` : ''}`}
      className={cn(
        'bg-card hover:bg-secondary/60 block min-w-0 rounded-md border',
        layout === 'compact' ? 'space-y-0.5 px-1.5 py-1 text-xs' : 'px-3 py-2 text-[13px]',
        movable && 'cursor-grab active:cursor-grabbing',
        selected && 'border-primary ring-primary/30 ring-2',
        item.status === 'ARCHIVED' && 'opacity-60',
      )}
    >
      {layout === 'compact' ? (
        <>
          <span className="flex min-w-0 items-center gap-1.5">
            {dot}
            <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1">
            {showTime && time ? (
              <span className="text-muted-foreground tabular-nums">{time}</span>
            ) : null}
            {item.platformKeys.slice(0, 3).map((key) => (
              <PlatformMark key={key} platformKey={key} className="h-4 min-w-5 text-[9px]" />
            ))}
            {item.platformKeys.length > 3 ? (
              <span className="text-muted-foreground text-[10px]">
                +{item.platformKeys.length - 3}
              </span>
            ) : null}
            <span className="text-muted-foreground ml-auto truncate text-[10px]">
              {STATUS_LABELS[item.status]}
            </span>
          </span>
        </>
      ) : (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {time ? (
            <span className="text-muted-foreground w-11 shrink-0 tabular-nums">{time}</span>
          ) : null}
          {dot}
          <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
          <span className="flex shrink-0 items-center gap-0.5">
            {item.platformKeys.map((key) => (
              <PlatformMark key={key} platformKey={key} />
            ))}
          </span>
          <StatusBadge status={item.status} className="shrink-0" />
        </span>
      )}
    </Link>
  );
}
