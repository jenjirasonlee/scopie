'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { segment: 'profile', label: 'Profile' },
  { segment: 'organization', label: 'Organization' },
  { segment: 'members', label: 'Members & roles' },
  { segment: 'public-data', label: 'Public data' },
  { segment: 'connections', label: 'Connections' },
];

export function SettingsNav() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="flex gap-1 md:flex-col">
      {SECTIONS.map((section) => {
        const href = `/${orgSlug}/settings/${section.segment}`;
        const active = pathname === href;
        return (
          <Link
            key={section.segment}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'text-muted-foreground hover:bg-secondary hover:text-foreground rounded-md px-2.5 py-1.5 text-[13px]',
              active && 'bg-secondary text-foreground font-medium',
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
