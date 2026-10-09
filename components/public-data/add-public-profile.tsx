'use client';

import { AlertCircle, Check, Minus } from 'lucide-react';
import { useActionState, useState } from 'react';
import { FormField } from '@/components/shared/form-field';
import { SubmitButton } from '@/components/shared/submit-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { BUSINESS_ROLE_LABELS, BUSINESS_ROLES } from '@/lib/accounts/labels';
import type { LookupState } from '@/lib/public-data/shared';

type Option = { value: string; label: string };
type Action = (state: LookupState, formData: FormData) => Promise<LookupState>;

/** What Business Discovery gives for any business or creator account (PHASE_3_PLAN.md §2). */
const TRACKABLE = [
  'Followers, observed once a day from today',
  'Number of posts on the profile',
  'Bio and website, with changes recorded',
  'Posts: link, caption, date, format and hashtags',
  'Likes per post (unless the owner hides them)',
  'Comments per post',
  'Views on Reels',
];
const NOT_PUBLIC = [
  'Reach, saves and shares',
  'Audience demographics',
  'Stories',
  'Follower history before today',
];

const nf = new Intl.NumberFormat('en-GB');

export function AddPublicProfile({
  lookupAction,
  addAction,
  countries,
  canPreview,
}: {
  lookupAction: Action;
  addAction: Action;
  countries: Option[];
  /** False when no viewer account is set up yet: profiles can still be added. */
  canPreview: boolean;
}) {
  const [lookup, lookupFormAction] = useActionState(lookupAction, { status: 'idle' });
  const [added, addFormAction] = useActionState(addAction, { status: 'idle' });
  const [handle, setHandle] = useState('');
  const preview = lookup.status === 'success' ? lookup.preview : undefined;
  const handleForSave = preview?.username ?? (handle || lookup.handle || '');

  return (
    <div className="space-y-5">
      <form action={lookupFormAction} className="flex flex-wrap items-end gap-2">
        <FormField
          id="lookup-handle"
          label="Instagram username"
          hint="A business or creator account, e.g. @brandname or a profile link."
          className="min-w-64 flex-1"
        >
          <Input
            name="handle"
            placeholder="@username"
            autoComplete="off"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            required
          />
        </FormField>
        {canPreview ? (
          <SubmitButton variant="outline" pendingLabel="Looking up…" className="mb-5">
            Preview
          </SubmitButton>
        ) : null}
      </form>

      {lookup.status === 'error' && lookup.message ? (
        <Alert variant="destructive" aria-live="polite">
          <AlertCircle aria-hidden />
          <AlertDescription>{lookup.message}</AlertDescription>
        </Alert>
      ) : null}

      {preview ? (
        <div className="bg-card space-y-4 rounded-lg border p-4" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">{preview.displayName ?? preview.username}</p>
              <p className="text-muted-foreground text-[13px]">@{preview.username}</p>
            </div>
            <Badge variant="secondary">PUBLIC · read today</Badge>
          </div>
          {preview.biography ? (
            <p className="text-[13px] whitespace-pre-line">{preview.biography}</p>
          ) : null}
          <dl className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Followers</dt>
              <dd className="font-medium tabular-nums">
                {preview.followers === null ? 'not available' : nf.format(preview.followers)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Posts</dt>
              <dd className="font-medium tabular-nums">
                {preview.postsTotal === null ? 'not available' : nf.format(preview.postsTotal)}
              </dd>
            </div>
            {preview.website ? (
              <div className="col-span-2 sm:col-span-1">
                <dt className="text-muted-foreground">Website</dt>
                <dd className="truncate">{preview.website}</dd>
              </div>
            ) : null}
          </dl>
          <div className="grid gap-4 text-[13px] sm:grid-cols-2">
            <div>
              <p className="mb-1 font-medium">Scopie can track</p>
              <ul className="space-y-1">
                {TRACKABLE.map((item) => (
                  <li key={item} className="flex gap-2">
                    <Check className="text-success mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 font-medium">Not public, so never shown</p>
              <ul className="text-muted-foreground space-y-1">
                {NOT_PUBLIC.map((item) => (
                  <li key={item} className="flex gap-2">
                    <Minus className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      <form action={addFormAction} className="space-y-4">
        <input type="hidden" name="handle" value={handleForSave} />
        {preview ? <input type="hidden" name="externalId" value={preview.externalId} /> : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField id="add-name" label="Name in Scopie" optional>
            <Input
              name="displayName"
              defaultValue={preview?.displayName ?? ''}
              key={preview?.externalId ?? 'none'}
              placeholder={handleForSave || 'Brand name'}
            />
          </FormField>
          <FormField id="add-role" label="Why you track it">
            <NativeSelect name="businessRole" defaultValue="competitor" required>
              {BUSINESS_ROLES.map((role) => (
                <option key={role} value={role}>
                  {BUSINESS_ROLE_LABELS[role]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="add-country" label="Country" optional>
            <NativeSelect name="countryCode" defaultValue="">
              <option value="">No country</option>
              {countries.map((country) => (
                <option key={country.value} value={country.value}>
                  {country.label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>
        {added.status === 'error' && added.message ? (
          <p className="text-destructive text-[13px]" role="alert">
            {added.message}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton disabled={!handleForSave} pendingLabel="Adding…">
            Start tracking
          </SubmitButton>
          <p className="text-muted-foreground text-xs">
            History starts today. Scopie never shows numbers for days it didn&apos;t observe.
          </p>
        </div>
      </form>
    </div>
  );
}
