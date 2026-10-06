'use client';

import { useActionState, useEffect, useState } from 'react';
import { FormField } from '@/components/shared/form-field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Input } from '@/components/ui/input';
import { initialFormState } from '@/lib/forms';
import { createOrganization } from '@/lib/orgs/actions';
import { slugify } from '@/lib/orgs/slug';
import { TimezoneSelect } from './timezone-select';

export function OnboardingForm() {
  const [state, action] = useActionState(createOrganization, initialFormState);
  const [name, setName] = useState(state.values?.name ?? '');
  const [slug, setSlug] = useState(state.values?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(Boolean(state.values?.slug));
  const [timezone, setTimezone] = useState(state.values?.defaultTimezone ?? 'UTC');

  // The browser's timezone is only known on the client; default to it after hydration.
  useEffect(() => {
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client-only default
    if (browserTimezone) setTimezone((current) => (current === 'UTC' ? browserTimezone : current));
  }, []);

  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <FormField id="name" label="Organization name" errors={state.fieldErrors?.name}>
        <Input
          name="name"
          required
          placeholder="e.g. CANNA Corporate"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (!slugTouched) setSlug(slugify(event.target.value));
          }}
        />
      </FormField>
      <FormField
        id="slug"
        label="URL"
        hint={`scopie/${slug || 'your-organization'}`}
        errors={state.fieldErrors?.slug}
      >
        <Input
          name="slug"
          required
          value={slug}
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(event.target.value.toLowerCase());
          }}
        />
      </FormField>
      <FormField
        id="defaultTimezone"
        label="Default timezone"
        errors={state.fieldErrors?.defaultTimezone}
      >
        <TimezoneSelect
          name="defaultTimezone"
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
        />
      </FormField>
      <SubmitButton className="w-full" pendingLabel="Creating…">
        Create organization
      </SubmitButton>
    </form>
  );
}
