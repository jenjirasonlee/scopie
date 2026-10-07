'use client';

import { InlineActionForm } from '@/components/pipeline/inline-action-form';
import { NativeSelect } from '@/components/ui/native-select';
import type { FormState } from '@/lib/forms';

export function ViewerForm({
  action,
  options,
  current,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  options: { value: string; label: string }[];
  current: string | null;
}) {
  return (
    <InlineActionForm
      action={action}
      hidden={{}}
      label={current ? 'Change' : 'Use this account'}
      pendingLabel="Saving…"
      variant="default"
    >
      <div className="w-72">
        <NativeSelect
          name="assetId"
          defaultValue={current ?? ''}
          required
          aria-label="Viewer Instagram account"
        >
          <option value="" disabled>
            Choose an Instagram account
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </div>
    </InlineActionForm>
  );
}
