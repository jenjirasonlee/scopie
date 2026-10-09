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
import type { LookupState, PublicProfilePlatform } from '@/lib/public-data/shared';

type Option = { value: string; label: string };
type Action = (state: LookupState, formData: FormData) => Promise<LookupState>;

/** What each official public API gives for any public profile (PHASE_3_PLAN.md §2). */
const TRACKABLE: Record<PublicProfilePlatform, string[]> = {
  instagram: [
    'Followers, observed once a day from today',
    'Number of posts on the profile',
    'Bio and website, with changes recorded',
    'Posts: link, caption, date, format and hashtags',
    'Likes per post (unless the owner hides them)',
    'Comments per post',
    'Views on Reels',
  ],
  youtube: [
    'Subscribers, observed once a day (YouTube rounds them to 3 significant figures)',
    'Number of videos and total channel views',
    'Channel description, with changes recorded',
    'Videos: link, title, description, date and hashtags',
    'Views, likes (unless hidden) and comments (unless turned off) per video',
  ],
  x: [
    'Followers, observed once a day from today',
    'Number of posts (X counts replies and reposts too) and accounts followed',
    'Bio and website, with changes recorded',
    'Posts: link, text, date, format and hashtags (no replies or reposts)',
    'Likes, replies, reposts, quotes, bookmarks and views per post',
    'Posts deleted on X are deleted in Scopie too',
  ],
  bluesky: [
    'Followers, observed once a day from today',
    'Number of posts and accounts followed',
    'Display name and bio, with changes recorded',
    'Posts: link, text, date, format and hashtags (no replies or reposts)',
    'Likes, replies, reposts and quotes per post',
  ],
};
const NOT_PUBLIC: Record<PublicProfilePlatform, string[]> = {
  instagram: [
    'Reach, saves and shares',
    'Audience demographics',
    'Stories',
    'Follower history before today',
  ],
  youtube: [
    'Watch time and retention',
    'Audience demographics and traffic sources',
    'Whether a video is a Short (not exposed by the API)',
    'Subscriber history before today',
  ],
  x: [
    'Protected accounts (only approved followers can see them)',
    'Link clicks, profile visits and audience demographics',
    'Posts from more than 30 days before you add it',
    'Follower history before today',
  ],
  bluesky: [
    'Views (Bluesky doesn’t count them)',
    'Audience demographics',
    'Accounts that ask apps not to show them to logged-out people',
    'Follower history before today',
  ],
};

const FIELD: Record<PublicProfilePlatform, { label: string; hint: string }> = {
  instagram: {
    label: 'Instagram username',
    hint: 'A business or creator account, e.g. @brandname or a profile link.',
  },
  youtube: {
    label: 'YouTube handle',
    hint: 'Any public channel, e.g. @brandname or a channel link.',
  },
  x: { label: 'X username', hint: 'Any public account, e.g. @brandname or an x.com link.' },
  bluesky: {
    label: 'Bluesky handle',
    hint: 'E.g. brand.bsky.social, a custom domain, or a bsky.app profile link.',
  },
};

/** Platforms in the order they are offered. */
export const PUBLIC_PLATFORM_OPTIONS: { value: PublicProfilePlatform; label: string }[] = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'x', label: 'X' },
  { value: 'bluesky', label: 'Bluesky' },
];

const nf = new Intl.NumberFormat('en-GB');

export function AddPublicProfile({
  lookupAction,
  addAction,
  countries,
  canPreview,
  setupNote,
}: {
  lookupAction: Action;
  addAction: Action;
  countries: Option[];
  /** Per platform: false when its API isn't set up yet. Profiles can still be added. */
  canPreview: Record<PublicProfilePlatform, boolean>;
  /** Per platform: what is missing on the server, shown when preview is off. */
  setupNote?: Partial<Record<PublicProfilePlatform, string>>;
}) {
  const [platform, setPlatform] = useState<PublicProfilePlatform>('instagram');
  const [lookup, lookupFormAction] = useActionState(lookupAction, { status: 'idle' });
  const [added, addFormAction] = useActionState(addAction, { status: 'idle' });
  const [handle, setHandle] = useState('');
  const preview = lookup.status === 'success' ? lookup.preview : undefined;
  const handleForSave = preview?.username ?? (handle || lookup.handle || '');

  return (
    <div className="space-y-5">
      <form action={lookupFormAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="platform" value={platform} />
        <FormField id="lookup-platform" label="Platform" className="w-40">
          <NativeSelect
            value={platform}
            onChange={(event) => setPlatform(event.target.value as PublicProfilePlatform)}
          >
            {PUBLIC_PLATFORM_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField
          id="lookup-handle"
          label={FIELD[platform].label}
          hint={FIELD[platform].hint}
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
        {canPreview[platform] ? (
          <SubmitButton variant="outline" pendingLabel="Looking up…" className="mb-5">
            Preview
          </SubmitButton>
        ) : null}
      </form>
      {!canPreview[platform] && setupNote?.[platform] ? (
        <p className="text-muted-foreground -mt-3 text-[13px]">{setupNote[platform]}</p>
      ) : null}

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
              <dt className="text-muted-foreground">
                {platform === 'youtube' ? 'Subscribers' : 'Followers'}
              </dt>
              <dd className="font-medium tabular-nums">
                {preview.followers === null ? 'not available' : nf.format(preview.followers)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {platform === 'youtube' ? 'Videos' : 'Posts'}
              </dt>
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
                {TRACKABLE[platform].map((item) => (
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
                {NOT_PUBLIC[platform].map((item) => (
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
        <input type="hidden" name="platform" value={platform} />
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
