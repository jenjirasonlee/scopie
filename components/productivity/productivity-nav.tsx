import { Check, Lock } from 'lucide-react';
import Link from 'next/link';
import {
  PERIOD_KEYS,
  PERIOD_LABELS,
  PRODUCTIVITY_VIEWS,
  productivityHref,
  VIEW_LABELS,
  type PeriodKey,
  type ProductivityView,
} from '@/lib/productivity/shared';
import { cn } from '@/lib/utils';

/** The Team / Your impact tabs. */
export function ProductivityTabs({
  orgSlug,
  view,
  period,
}: {
  orgSlug: string;
  view: ProductivityView;
  period: PeriodKey;
}) {
  return (
    <nav
      aria-label="Productivity views"
      className="flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-border)]"
    >
      {PRODUCTIVITY_VIEWS.map((tab) => {
        const current = tab === view;
        return (
          <Link
            key={tab}
            href={productivityHref(orgSlug, tab, period)}
            aria-current={current ? 'page' : undefined}
            scroll={false}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 pt-1 pb-2 text-[13px] whitespace-nowrap',
              current
                ? 'border-primary text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {tab === 'you' ? <Lock className="size-3.5" aria-hidden /> : null}
            {VIEW_LABELS[tab]}
            {tab === 'you' ? (
              <span className="text-muted-foreground text-[11px]">Private</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** This quarter, last quarter, last 90 days. */
export function PeriodFilter({
  orgSlug,
  view,
  period,
}: {
  orgSlug: string;
  view: ProductivityView;
  period: PeriodKey;
}) {
  return (
    <nav aria-label="Period" className="bg-muted/60 inline-flex flex-wrap rounded-md border p-0.5">
      {PERIOD_KEYS.map((option) => {
        const active = option === period;
        return (
          <Link
            key={option}
            href={productivityHref(orgSlug, view, option)}
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
            {PERIOD_LABELS[option]}
          </Link>
        );
      })}
    </nav>
  );
}
