'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/shared/form-message';
import { SubmitButton } from '@/components/shared/submit-button';
import { Input } from '@/components/ui/input';
import { initialFormState, type FormState } from '@/lib/forms';

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Name field used to create or rename a group. */
export function GroupNameForm({
  action,
  defaultName = '',
  submitLabel,
  idPrefix,
}: {
  action: Action;
  defaultName?: string;
  submitLabel: string;
  idPrefix: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const error = state.fieldErrors?.name?.[0];
  const id = `${idPrefix}-name`;
  return (
    <form action={formAction} className="space-y-2" noValidate>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full space-y-1 sm:w-72">
          <label htmlFor={id} className="text-muted-foreground block text-xs font-medium">
            Group name
          </label>
          <Input
            id={id}
            name="name"
            maxLength={80}
            required
            placeholder="e.g. Spain competitors"
            defaultValue={state.values?.name ?? defaultName}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          />
        </div>
        <SubmitButton size="sm" variant="outline">
          {submitLabel}
        </SubmitButton>
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
      {error ? null : <FormMessage state={state} />}
    </form>
  );
}

/** Checkbox list of profiles to add to a group. */
export function AddMembersForm({
  action,
  groupId,
  options,
}: {
  action: Action;
  groupId: string;
  options: { platform: string; profiles: { id: string; label: string; detail: string }[] }[];
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const error = state.fieldErrors?.accountIds?.[0];
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="groupId" value={groupId} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((option) => (
          <fieldset key={option.platform} className="space-y-1.5">
            <legend className="text-muted-foreground mb-1 text-xs font-semibold">
              {option.platform}
            </legend>
            {option.profiles.map((profile) => (
              <label key={profile.id} className="flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  name="accountId"
                  value={profile.id}
                  className="accent-primary mt-0.5 size-4"
                />
                <span className="min-w-0">
                  <span className="block truncate">{profile.label}</span>
                  <span className="text-muted-foreground block text-xs">{profile.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      <FormMessage state={error ? { status: 'idle' } : state} />
      <SubmitButton size="sm">Add selected profiles</SubmitButton>
    </form>
  );
}
