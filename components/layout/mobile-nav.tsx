'use client';

import { Menu, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { type ComponentProps, useState } from 'react';
import { Logo } from '@/components/shared/logo';
import { Button } from '@/components/ui/button';
import { SidebarNav } from './sidebar-nav';

export function MobileNav({ counts }: { counts?: ComponentProps<typeof SidebarNav>['counts'] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
          <Menu />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content className="bg-sidebar fixed inset-y-0 left-0 z-50 flex w-64 flex-col gap-4 border-r p-3 shadow-lg">
          <div className="flex items-center justify-between px-1">
            <Dialog.Title asChild>
              <Logo />
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close navigation">
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Main navigation</Dialog.Description>
          <SidebarNav counts={counts} onNavigate={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
