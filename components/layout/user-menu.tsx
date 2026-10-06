'use client';

import { LogOut, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOut } from '@/lib/auth/actions';

export function UserMenu({
  orgSlug,
  name,
  email,
}: {
  orgSlug: string;
  name: string | null;
  email: string;
}) {
  const [signingOut, startSignOut] = useTransition();
  const initials = (name ?? email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <span className="bg-secondary flex size-7 items-center justify-center rounded-full text-xs font-semibold">
            {initials}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col">
          <span className="text-foreground truncate text-sm font-medium">
            {name ?? 'Your account'}
          </span>
          <span className="truncate">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/${orgSlug}/settings/profile`}>
            <UserRound aria-hidden />
            Profile
          </Link>
        </DropdownMenuItem>
        {/* Call the action directly: a <form> inside the menu would unmount before it submits. */}
        <DropdownMenuItem disabled={signingOut} onSelect={() => startSignOut(() => signOut())}>
          <LogOut aria-hidden />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
