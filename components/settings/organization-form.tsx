'use client';

import { useActionState } from 'react';
import { TimezoneSelect } from '@/components/orgs/timezone-select';
import { FormField } from '@/components/shared/form-field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Input } from '@/components/ui/input';
import { initialFormState, type FormState } from '@/lib/forms';

export function OrganizationForm({
  action,
  name,
  slug,
  defaultTimezone,
  canEdit,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  name: string;
  slug: string;
  defaultTimezone: string;
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <FormField id="name" label="Organization name" errors={state.fieldErrors?.name}>
        <Input name="name" defaultValue={state.values?.name ?? name} disabled={!canEdit} required />
      </FormField>
      <FormField id="slug" label="URL" hint="The organization URL can't be changed yet.">
        <Input value={slug} readOnly disabled />
      </FormField>
      <FormField
        id="defaultTimezone"
        label="Default timezone"
        errors={state.fieldErrors?.defaultTimezone}
      >
        <TimezoneSelect
          name="defaultTimezone"
          defaultValue={state.values?.defaultTimezone ?? defaultTimezone}
          disabled={!canEdit}
        />
      </FormField>
      {canEdit ? <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton> : null}
    </form>
  );
}
