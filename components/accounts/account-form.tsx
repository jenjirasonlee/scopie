'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormField } from '@/components/shared/form-field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { TimezoneSelect } from '@/components/orgs/timezone-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { initialFormState, type FormState } from '@/lib/forms';
import { ACCOUNT_TYPES } from '@/schemas/social-account';

export type AccountFormDefaults = {
  platformKey?: string;
  displayName?: string;
  handle?: string | null;
  externalId?: string | null;
  accountType?: string | null;
  countryCode?: string | null;
  language?: string | null;
  timezone?: string | null;
  ownerUserId?: string | null;
  isCompetitor?: boolean;
  notes?: string | null;
};

type Option = { value: string; label: string };

export function AccountForm({
  action,
  defaults = {},
  platforms,
  countries,
  members,
  submitLabel,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults?: AccountFormDefaults;
  platforms: Option[];
  countries: Option[];
  members: Option[];
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const errors = state.fieldErrors ?? {};
  // After a failed submit, show what the user typed rather than the stored values.
  const value = (key: keyof AccountFormDefaults & string) =>
    state.values ? (state.values[key] ?? '') : String(defaults[key] ?? '');

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <FormMessage state={state} />

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold">Account</legend>
        <FormField id="platformKey" label="Platform" errors={errors.platformKey}>
          <NativeSelect name="platformKey" defaultValue={value('platformKey')} required>
            <option value="" disabled>
              Choose a platform
            </option>
            {platforms.map((platform) => (
              <option key={platform.value} value={platform.value}>
                {platform.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="accountType" label="Account type" optional errors={errors.accountType}>
          <NativeSelect name="accountType" defaultValue={value('accountType')}>
            <option value="">Not specified</option>
            {ACCOUNT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="displayName" label="Account name" errors={errors.displayName}>
          <Input
            name="displayName"
            defaultValue={value('displayName')}
            placeholder="e.g. CANNA Germany"
            required
          />
        </FormField>
        <FormField id="handle" label="Handle" optional hint="Without the @." errors={errors.handle}>
          <Input name="handle" defaultValue={value('handle')} placeholder="canna_germany" />
        </FormField>
        <FormField
          id="externalId"
          label="Platform account ID"
          optional
          hint="Filled in automatically once a connector is available."
          errors={errors.externalId}
        >
          <Input name="externalId" defaultValue={value('externalId')} />
        </FormField>
        <FormField id="ownerUserId" label="Owner" optional errors={errors.ownerUserId}>
          <NativeSelect name="ownerUserId" defaultValue={value('ownerUserId')}>
            <option value="">No owner</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-3 text-sm font-semibold">Market</legend>
        <FormField id="countryCode" label="Country" errors={errors.countryCode}>
          <NativeSelect name="countryCode" defaultValue={value('countryCode')}>
            <option value="">No country</option>
            {countries.map((country) => (
              <option key={country.value} value={country.value}>
                {country.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField
          id="language"
          label="Language"
          optional
          hint="e.g. de, nl, pt-BR"
          errors={errors.language}
        >
          <Input name="language" defaultValue={value('language')} />
        </FormField>
        <FormField id="timezone" label="Timezone" optional errors={errors.timezone}>
          <TimezoneSelect
            name="timezone"
            defaultValue={value('timezone')}
            allowEmpty="Organization default"
          />
        </FormField>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-3 text-sm font-semibold">Other</legend>
        <label className="flex items-start gap-2.5 text-[13px]">
          <input
            type="checkbox"
            name="isCompetitor"
            defaultChecked={
              state.values ? state.values.isCompetitor === 'on' : Boolean(defaults.isCompetitor)
            }
            className="mt-0.5 size-4 accent-[var(--primary)]"
          />
          <span>
            <span className="font-medium">Competitor account</span>
            <span className="text-muted-foreground block">
              Not owned by your organization. Only public data will ever be used for it.
            </span>
          </span>
        </label>
        <FormField id="notes" label="Notes" optional errors={errors.notes}>
          <Textarea name="notes" defaultValue={value('notes')} rows={3} />
        </FormField>
      </fieldset>

      <div className="flex items-center gap-2 border-t pt-5">
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
        <Button asChild variant="ghost">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
