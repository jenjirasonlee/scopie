'use client';

import { InlineActionForm } from '@/components/pipeline/inline-action-form';
import { NativeSelect } from '@/components/ui/native-select';
import type { FormState } from '@/lib/forms';

export function LinkAssetForm({
  action,
  assetId,
  assetLabel,
  accounts,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  assetId: string;
  assetLabel: string;
  accounts: { value: string; label: string }[];
}) {
  if (!accounts.length) {
    return (
      <span className="text-muted-foreground text-xs">
        Add a Scopie account on this platform to link it.
      </span>
    );
  }
  return (
    <InlineActionForm action={action} hidden={{ assetId }} label="Link" pendingLabel="Linking…">
      <div className="w-56">
        <NativeSelect
          name="accountId"
          defaultValue=""
          required
          aria-label={`Scopie account for ${assetLabel}`}
        >
          <option value="" disabled>
            Choose a Scopie account
          </option>
          {accounts.map((account) => (
            <option key={account.value} value={account.value}>
              {account.label}
            </option>
          ))}
        </NativeSelect>
      </div>
    </InlineActionForm>
  );
}
