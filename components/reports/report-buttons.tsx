'use client';

import { Check, FilePlus2, Link2, Printer } from 'lucide-react';
import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Button } from '@/components/ui/button';
import { initialFormState, type FormState } from '@/lib/forms';

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** The "Make last week's report" button. It opens the report once it is made. */
export function MakeReportForm({ action, label }: { action: Action; label: string }) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="flex max-w-sm flex-col items-end gap-2">
      <SubmitButton size="sm" pendingLabel="Making the report… this can take a minute">
        <FilePlus2 aria-hidden />
        {label}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

/** Copies this page's address, for sharing with other members of the organization. */
export function CopyLinkButton() {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setState('copied');
      window.setTimeout(() => setState('idle'), 2500);
    } catch {
      setState('failed');
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={copy}
        title="Only members of this organization can open the link."
      >
        {state === 'copied' ? <Check aria-hidden /> : <Link2 aria-hidden />}
        {state === 'copied' ? 'Link copied' : 'Copy link'}
      </Button>
      {state === 'failed' ? (
        <span role="status" className="text-muted-foreground text-xs">
          Couldn’t copy. Copy the address from your browser instead.
        </span>
      ) : (
        <span role="status" className="sr-only">
          {state === 'copied' ? 'Link copied' : ''}
        </span>
      )}
    </span>
  );
}

export function PrintButton() {
  return (
    <Button type="button" size="sm" variant="outline" onClick={() => window.print()}>
      <Printer aria-hidden />
      Print
    </Button>
  );
}
