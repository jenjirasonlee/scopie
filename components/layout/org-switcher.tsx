'use client';

import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ROLE_LABELS, type OrgRole } from '@/lib/auth/permissions';

type Org = { id: string; name: string; slug: string; role: OrgRole; is_demo: boolean };

export function OrgSwitcher({ current, organizations }: { current: Org; organizations: Org[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-8 max-w-64 gap-2 px-2"
          aria-label="Switch organization"
        >
          <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-sm text-[10px] font-semibold">
            {current.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="truncate font-medium">{current.name}</span>
          <span className="text-muted-foreground text-xs font-normal">
            {ROLE_LABELS[current.role]}
          </span>
          <ChevronsUpDown className="text-muted-foreground size-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {organizations.map((org) => (
          <DropdownMenuItem key={org.id} asChild>
            <Link href={`/${org.slug}/dashboard`}>
              <span className="flex-1 truncate">{org.name}</span>
              {org.id === current.id ? (
                <Check className="text-primary" aria-label="Current" />
              ) : null}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding">
            <Plus aria-hidden />
            New organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
