'use client';

import { useActionState } from 'react';
import { TimezoneSelect } from '@/components/orgs/timezone-select';
import { FormField } from '@/components/shared/form-field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Input } from '@/components/ui/input';
import { initialFormState } from '@/lib/forms';
import { updateProfile } from '@/lib/profile/actions';

export function ProfileForm({
  email,
  fullName,
  timezone,
}: {
  email: string;
  fullName: string;
  timezone: string;
}) {
  const [state, action] = useActionState(updateProfile, initialFormState);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <FormField id="email" label="Email" hint="Your sign-in email.">
        <Input value={email} readOnly disabled />
      </FormField>
      <FormField id="fullName" label="Full name" errors={state.fieldErrors?.fullName}>
        <Input name="fullName" defaultValue={state.values?.fullName ?? fullName} required />
      </FormField>
      <FormField id="timezone" label="Timezone" errors={state.fieldErrors?.timezone}>
        <TimezoneSelect
          name="timezone"
          defaultValue={state.values?.timezone ?? timezone}
          allowEmpty="Use organization default"
        />
      </FormField>
      <SubmitButton pendingLabel="Saving…">Save profile</SubmitButton>
    </form>
  );
}
