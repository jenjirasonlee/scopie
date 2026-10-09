import Link from 'next/link';
import { QUEUE_TABS, type QueueTab } from '@/lib/approvals/shared';
import { cn } from '@/lib/utils';
import { QUEUE_TAB_LABELS } from './queue-shared';

/** The review queue's tabs, each with how many items it holds. */
export function QueueTabs({
  orgSlug,
  active,
  counts,
}: {
  orgSlug: string;
  active: QueueTab;
  counts: Record<QueueTab, number>;
}) {
  return (
    <nav
      aria-label="Review queue"
      className="flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-border)]"
    >
      {QUEUE_TABS.map((tab) => {
        const current = tab === active;
        return (
          <Link
            key={tab}
            href={tab === 'waiting' ? `/${orgSlug}/approvals` : `/${orgSlug}/approvals?tab=${tab}`}
            aria-current={current ? 'page' : undefined}
            scroll={false}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 pt-1 pb-2 text-[13px] whitespace-nowrap',
              current
                ? 'border-primary text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {QUEUE_TAB_LABELS[tab]}
            <span
              className={cn(
                'rounded-sm px-1.5 text-[11px] font-semibold tabular-nums',
                current ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
              )}
            >
              {counts[tab]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
