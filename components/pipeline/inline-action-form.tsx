'use client';

import { useActionState } from 'react';
import { SubmitButton } from '@/components/shared/submit-button';
import { initialFormState, type FormState } from '@/lib/forms';
import { cn } from '@/lib/utils';

/** A one-button form that shows the action's message next to the button. */
export function InlineActionForm({
  action,
  hidden,
  label,
  pendingLabel,
  variant = 'outline',
  children,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  hidden: Record<string, string>;
  label: string;
  pendingLabel?: string;
  variant?: 'outline' | 'default' | 'ghost';
  children?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <SubmitButton variant={variant} size="sm" pendingLabel={pendingLabel}>
        {label}
      </SubmitButton>
      {state.message ? (
        <span
          role="status"
          className={cn(
            'text-xs',
            state.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
