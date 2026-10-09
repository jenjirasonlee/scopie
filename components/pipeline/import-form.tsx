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
  // Controlled, so a failed import keeps the choices (React resets uncontrolled fields).
  const [accountId, setAccountId] = useState(defaultAccountId ?? '');
  const [kind, setKind] = useState<ImportKind>('posts');
  return (
    <form action={formAction} className="space-y-4" encType="multipart/form-data">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="accountId">Account</Label>
          <NativeSelect
            id="accountId"
            name="accountId"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
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
      {state.status === 'done' ? <ImportResult summary={state.summary} kind={kind} /> : null}
    </form>
  );
}

/** Columns that only appear in the other kind of file, to spot a file imported as the wrong kind. */
const OTHER_KIND_COLUMNS: Record<ImportKind, string[]> = {
  posts: ['date', 'followers', 'followers_gained', 'followers_lost', 'profile_views'],
  account_metrics: ['post_id', 'published_at', 'permalink', 'caption'],
};

function ImportResult({
  summary,
  kind,
}: {
  summary: Extract<ImportState, { status: 'done' }>['summary'];
  kind: ImportKind;
}) {
  const ok = summary.status !== 'failed';
  const wrongKind =
    !ok && summary.ignoredColumns.some((column) => OTHER_KIND_COLUMNS[kind].includes(column));
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
        {wrongKind ? (
          <p>
            This looks like a file of{' '}
            {kind === 'posts' ? 'account metrics by day' : 'posts and their metrics'}. Choose that
            under “The file contains” and import it again.
          </p>
        ) : null}
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
