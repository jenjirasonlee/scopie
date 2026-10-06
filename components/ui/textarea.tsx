import * as React from 'react';
import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-input bg-card placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/25 aria-invalid:border-destructive min-h-20 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-[3px] disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
