'use client';

import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useActionState, useState } from 'react';
import { SubmitButton } from '@/components/shared/submit-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import type { ImportState } from '@/lib/imports/actions';
import type { ImportKind } from '@/lib/imports/templates';

export function ImportForm({
  action,
  accounts,
  defaultAccountId,
}: {
  action: (state: ImportState, formData: FormData) => Promise<ImportState>;
  accounts: { value: string; label: string }[];
  defaultAccountId?: string;
}) {
  const [state, formAction] = useActionState(action, { status: 'idle' } as ImportState);
  const [kind, setKind] = useState<ImportKind>('posts');
  return (
    <form action={formAction} className="space-y-4" encType="multipart/form-data">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="accountId">Account</Label>
          <NativeSelect
            id="accountId"
            name="accountId"
            defaultValue={defaultAccountId ?? ''}
            required
          >
            <option value="" disabled>
              Choose an account
            </option>
            {accounts.map((account) => (
              <option key={account.value} value={account.value}>
                {account.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kind">The file contains</Label>
          <NativeSelect
            id="kind"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as ImportKind)}
          >
            <option value="posts">Posts and their metrics</option>
            <option value="account_metrics">Account metrics by day</option>
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="file">CSV file (up to 5 MB)</Label>
        <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
      </div>
      <SubmitButton pendingLabel="Importing…">Import</SubmitButton>

      {state.status === 'error' ? (
        <Alert variant="destructive" aria-live="polite">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {state.status === 'done' ? <ImportResult summary={state.summary} /> : null}
    </form>
  );
}

function ImportResult({
  summary,
}: {
  summary: Extract<ImportState, { status: 'done' }>['summary'];
}) {
  const ok = summary.status !== 'failed';
  return (
    <Alert variant={ok ? 'success' : 'destructive'} aria-live="polite" data-testid="import-result">
      {ok ? <CheckCircle2 aria-hidden /> : <AlertCircle aria-hidden />}
      <AlertDescription className="space-y-2">
        <p>
          {ok
            ? `Imported ${summary.rowsImported} of ${summary.rowsTotal} rows.`
            : 'Nothing was imported.'}
          {summary.rowsSkipped ? ` ${summary.rowsSkipped} skipped.` : ''}
          {summary.duplicatesSkipped
            ? ` ${summary.duplicatesSkipped} values were already stored.`
            : ''}
        </p>
        {summary.ignoredColumns.length ? (
          <p>Columns not used: {summary.ignoredColumns.join(', ')}.</p>
        ) : null}
        {summary.errors.length ? (
          <ul className="list-disc pl-4">
            {summary.errors.slice(0, 10).map((error, index) => (
              <li key={index}>
                {error.row > 0 ? `Row ${error.row}: ` : ''}
                {error.message}
              </li>
            ))}
            {summary.errors.length > 10 ? <li>…and {summary.errors.length - 10} more.</li> : null}
          </ul>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
