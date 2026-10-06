import * as React from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export function FormField({
  id,
  label,
  hint,
  errors,
  optional,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  errors?: string[];
  optional?: boolean;
  className?: string;
  children: React.ReactElement<{
    id?: string;
    'aria-invalid'?: boolean;
    'aria-describedby'?: string;
  }>;
}) {
  const describedBy = [hint ? `${id}-hint` : null, errors?.length ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  const control = React.cloneElement(children, {
    id,
    'aria-invalid': errors?.length ? true : undefined,
    'aria-describedby': describedBy || undefined,
  });
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {optional ? (
          <span className="text-muted-foreground ml-1 font-normal">(optional)</span>
        ) : null}
      </Label>
      {control}
      {hint && !errors?.length ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      {errors?.length ? (
        <p id={`${id}-error`} className="text-destructive text-xs">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}
