'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Input } from '@/components/ui/input';
import { rescheduleContentItemForm } from '@/lib/calendar/actions';
import { initialFormState } from '@/lib/forms';

/** Change an item's publish day from the side panel. Keeps its time of day. */
export function RescheduleForm({
  orgSlug,
  itemId,
  defaultDate,
}: {
  orgSlug: string;
  itemId: string;
  defaultDate: string;
}) {
  const [state, action] = useActionState(
    rescheduleContentItemForm.bind(null, orgSlug, itemId),
    initialFormState,
  );
  return (
    <form action={action} className="space-y-2">
      <label htmlFor="reschedule-date" className="text-muted-foreground block text-xs font-medium">
        Move to another day
      </label>
      <div className="flex gap-2">
        <Input
          id="reschedule-date"
          type="date"
          name="date"
          required
          defaultValue={state.values?.date ?? defaultDate}
          className="w-44"
        />
        <SubmitButton variant="outline" pendingLabel="Saving…">
          Save date
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
