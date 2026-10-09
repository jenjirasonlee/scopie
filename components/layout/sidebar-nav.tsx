'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { NAV_ITEMS } from '@/lib/navigation';
import { badgeCount } from '@/lib/notifications/shared';
import { cn } from '@/lib/utils';

export function SidebarNav({
  onNavigate,
  counts,
}: {
  onNavigate?: () => void;
  /** Small counts next to a section, by navigation key, with what they count. */
  counts?: Partial<Record<string, { count: number; label: string }>>;
}) {
  const params = useParams<{ orgSlug: string }>();
  const pathname = usePathname();
  const base = `/${params.orgSlug}`;

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const href = `${base}/${item.segment}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const Icon = item.icon;
        const badge = counts?.[item.key];
        const shown = badge ? badgeCount(badge.count) : null;
        return (
          <Link
            key={item.key}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors',
              active && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
            )}
          >
            <Icon
              className={cn('text-muted-foreground size-4', active && 'text-primary')}
              aria-hidden
            />
            <span className="flex-1">{item.label}</span>
            {shown && badge ? (
              <span
                className="bg-primary/10 text-primary rounded-sm px-1.5 text-[11px] font-semibold tabular-nums"
                title={`${badge.count} ${badge.label}`}
              >
                {shown}
                <span className="sr-only"> {badge.label}</span>
              </span>
            ) : null}
            {item.status === 'planned' ? (
              <span
                className="text-muted-foreground/70 text-[10px] font-medium"
                title={`Planned for Phase ${item.phase}`}
              >
                Soon
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
