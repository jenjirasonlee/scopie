'use client';

import { useActionState } from 'react';
import { FormField } from '@/components/shared/form-field';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { BUSINESS_ROLE_LABELS, BUSINESS_ROLES } from '@/lib/accounts/labels';
import type { BulkResult } from '@/lib/public-data/actions';
import { PUBLIC_PLATFORM_OPTIONS } from './add-public-profile';

export function BulkAddProfiles({
  action,
}: {
  action: (state: BulkResult, formData: FormData) => Promise<BulkResult>;
}) {
  const [state, formAction] = useActionState(action, { status: 'idle' });
  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
        <FormField
          id="bulk-handles"
          label="Usernames"
          hint="One per line. Add a country code after a comma if you like: hydro_rival,NL"
        >
          <Textarea
            name="handles"
            rows={5}
            defaultValue={state.values?.handles}
            placeholder={'brand_one,NL\n@brand_two\nbrand_three,DE'}
          />
        </FormField>
        <div className="space-y-4">
          <FormField id="bulk-platform" label="Platform">
            <NativeSelect name="platform" defaultValue={state.values?.platform ?? 'instagram'}>
              {PUBLIC_PLATFORM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="bulk-role" label="Why you track them">
            <NativeSelect
              name="businessRole"
              defaultValue={state.values?.businessRole ?? 'competitor'}
              required
            >
              {BUSINESS_ROLES.map((role) => (
                <option key={role} value={role}>
                  {BUSINESS_ROLE_LABELS[role]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="bulk-file" label="Or a CSV file" optional>
            <Input type="file" name="file" accept=".csv,text/csv,text/plain" />
          </FormField>
        </div>
      </div>
      <FormMessage state={state} />
      {state.skipped?.length ? (
        <ul className="text-muted-foreground list-disc pl-5 text-[13px]">
          {state.skipped.map((entry) => (
            <li key={entry.handle}>
              {entry.handle}: {entry.reason}
            </li>
          ))}
        </ul>
      ) : null}
      <SubmitButton variant="outline" pendingLabel="Adding…">
        Add all
      </SubmitButton>
    </form>
  );
}
