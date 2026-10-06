import { ChevronDown } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

/** Styled native <select>: accessible, works without JavaScript, fine for forms and filters. */
function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        data-slot="native-select"
        className={cn(
          'border-input bg-card focus-visible:border-ring focus-visible:ring-ring/25 aria-invalid:border-destructive h-9 w-full appearance-none rounded-md border py-1 pr-8 pl-3 text-sm outline-none focus-visible:ring-[3px] disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2" />
    </div>
  );
}

export { NativeSelect };
