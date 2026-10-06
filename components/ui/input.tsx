import * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'border-input bg-card placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/25 aria-invalid:border-destructive aria-invalid:ring-destructive/20 h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
