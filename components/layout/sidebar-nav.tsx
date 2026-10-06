'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { NAV_ITEMS } from '@/lib/navigation';
import { cn } from '@/lib/utils';

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const params = useParams<{ orgSlug: string }>();
  const pathname = usePathname();
  const base = `/${params.orgSlug}`;

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const href = `${base}/${item.segment}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const Icon = item.icon;
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
