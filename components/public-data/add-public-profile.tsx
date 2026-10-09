'use client';

import {
  AlertCircle,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  Minus,
  Search,
} from 'lucide-react';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { PlatformMark } from '@/components/accounts/platform-mark';
import { SubmitButton } from '@/components/shared/submit-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { BUSINESS_ROLE_LABELS, BUSINESS_ROLES } from '@/lib/accounts/labels';
import {
  isSearchable,
  type LookupState,
  type PublicProfilePlatform,
  type SearchHit,
  type SearchResult,
} from '@/lib/public-data/shared';
import { cn } from '@/lib/utils';

type Option = { value: string; label: string };
type Action = (state: LookupState, formData: FormData) => Promise<LookupState>;
type SearchAction = (platform: string, query: string) => Promise<SearchResult>;

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

/** How to find a profile on each platform, in the search box's own words. */
const FIND: Record<PublicProfilePlatform, { placeholder: string; hint: string; site: string }> = {
  instagram: {
    placeholder: 'Paste a profile link or type the exact username',
    hint: 'Instagram doesn’t let apps search by name, so Scopie needs the exact username. Easiest: open the profile on Instagram, copy the link, and paste it here. It must be a business or creator account.',
    site: 'instagram.com',
  },
  youtube: {
    placeholder: 'Search by brand name, or paste a channel link',
    hint: 'Type a name and press Search, then pick the channel from the results.',
    site: 'youtube.com',
  },
  x: {
    placeholder: 'Paste a profile link or type the exact username',
    hint: 'X doesn’t let Scopie search by name, so it needs the exact username. Easiest: open the profile on X, copy the link, and paste it here.',
    site: 'x.com',
  },
  bluesky: {
    placeholder: 'Search by name or handle',
    hint: 'Start typing a name; matching profiles appear below.',
    site: 'bsky.app',
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
const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });

/** The profile about to be tracked: picked from search, checked, or just typed. */
type Choice = {
  handle: string;
  externalId?: string;
  displayName?: string | null;
  followers?: number | null;
  postsTotal?: number | null;
  biography?: string | null;
  website?: string | null;
  pictureUrl?: string | null;
  /** What was typed, sent to the server as-is (it reads links and @handles itself). */
  raw?: string;
  /** True when Scopie read it from the platform just now. */
  checked: boolean;
};

/** Strips a pasted link or @ down to what the user meant, for showing back only. */
function typedHandle(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(www\.|m\.)?[^/]+\/((profile|channel)\/)?/i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '');
}

/** True when the text is a link or @handle rather than a name to search for. */
function looksLikeHandle(value: string): boolean {
  const text = value.trim();
  return /^https?:\/\//i.test(text) || text.startsWith('@') || /\.[a-z]{2,}$/i.test(text);
}

export function AddPublicProfile({
  lookupAction,
  addAction,
  searchAction,
  countries,
  ready,
  setupNote,
  initialPlatform = 'instagram',
}: {
  lookupAction: Action;
  addAction: Action;
  searchAction: SearchAction;
  countries: Option[];
  /** Per platform: true when Scopie can read it on this server now. */
  ready: Record<PublicProfilePlatform, boolean>;
  /** Per platform: what is missing on the server, in plain words. */
  setupNote: Partial<Record<PublicProfilePlatform, React.ReactNode>>;
  initialPlatform?: PublicProfilePlatform;
}) {
  const [platform, setPlatform] = useState<PublicProfilePlatform>(initialPlatform);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [searching, startSearch] = useTransition();
  const [added, addFormAction] = useActionState(addAction, { status: 'idle' });
  const latest = useRef('');
  const [searched, setSearched] = useState('');
  const searchable = isSearchable(platform) && ready[platform];
  const find = FIND[platform];

  function reset(nextPlatform: PublicProfilePlatform) {
    setPlatform(nextPlatform);
    setQuery('');
    setHits(null);
    setMessage(null);
    setChoice(null);
  }

  function runSearch(text: string) {
    latest.current = text;
    startSearch(async () => {
      const result = await searchAction(platform, text);
      if (latest.current !== text) return;
      if (result.status === 'error') {
        setHits(null);
        setMessage(result.message);
      } else {
        setHits(result.hits);
        setSearched(text);
        setMessage(null);
      }
    });
  }

  function runCheck(text: string) {
    const formData = new FormData();
    formData.set('platform', platform);
    formData.set('handle', text);
    latest.current = text;
    startSearch(async () => {
      const result = await lookupAction({ status: 'idle' }, formData);
      if (latest.current !== text) return;
      if (result.status === 'success' && result.preview) {
        const p = result.preview;
        setChoice({
          handle: result.handle ?? p.username,
          externalId: p.externalId,
          displayName: p.displayName,
          followers: p.followers,
          postsTotal: p.postsTotal,
          biography: p.biography,
          website: p.website,
          checked: true,
        });
        setMessage(null);
      } else {
        setMessage(result.message ?? 'Could not check this profile.');
      }
    });
  }

  // Bluesky search is free, so it runs as you type.
  useEffect(() => {
    if (platform !== 'bluesky' || !searchable) return;
    const text = query.trim();
    if (text.length < 2 || looksLikeHandle(text)) return;
    const timer = setTimeout(() => runSearch(text), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, platform, searchable]);

  function submitFind() {
    const text = query.trim();
    if (!text) {
      setMessage('Type a name, username or profile link first.');
      return;
    }
    setMessage(null);
    if (searchable && !looksLikeHandle(text)) {
      runSearch(text);
      return;
    }
    // A username or link: use it, and check it when the platform can be read.
    setHits(null);
    setChoice({ handle: typedHandle(text), raw: text, checked: false });
    if (ready[platform]) runCheck(text);
  }

  function pick(hit: SearchHit) {
    setChoice({
      handle: hit.username,
      externalId: hit.externalId,
      displayName: hit.displayName,
      followers: hit.followers,
      pictureUrl: hit.profilePictureUrl,
      checked: true,
    });
    setHits(null);
  }

  const hint =
    isSearchable(platform) && !ready[platform]
      ? 'Paste the channel link or type the @handle. Searching by name works once the YouTube key is set up.'
      : find.hint;
  const followersLabel = platform === 'youtube' ? 'subscribers' : 'followers';
  const typed = query.trim();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium">1. Platform</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Platform">
          {PUBLIC_PLATFORM_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={platform === option.value}
              onClick={() => reset(option.value)}
              className={cn(
                'inline-flex h-10 items-center gap-2 rounded-md border px-3.5 text-sm transition-colors',
                platform === option.value
                  ? 'border-primary bg-primary/5 ring-primary font-medium ring-1'
                  : 'bg-card hover:bg-secondary',
              )}
            >
              <PlatformMark platformKey={option.value} />
              {option.label}
            </button>
          ))}
        </div>
        {!ready[platform] && setupNote[platform] ? (
          <Alert variant="warning">
            <AlertCircle aria-hidden />
            <AlertDescription>{setupNote[platform]}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="find-profile" className="text-sm">
          2. Find the profile
        </Label>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            submitFind();
          }}
        >
          <div className="relative flex-1">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id="find-profile"
              className="h-10 pl-9"
              placeholder={find.placeholder}
              autoComplete="off"
              value={query}
              onChange={(event) => {
                const text = event.target.value;
                setQuery(text);
                setMessage(null);
                if (platform === 'bluesky' && (text.trim().length < 2 || looksLikeHandle(text))) {
                  setHits(null);
                }
              }}
              aria-describedby="find-profile-hint"
            />
          </div>
          <Button type="submit" variant="outline" className="h-10" disabled={searching}>
            {searching ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {searchable ? 'Search' : ready[platform] ? 'Check' : 'Use this username'}
          </Button>
        </form>
        <p id="find-profile-hint" className="text-muted-foreground text-xs">
          {hint}{' '}
          {!isSearchable(platform) || !ready[platform] ? (
            <a
              className="inline-flex items-center gap-0.5 underline"
              href={`https://www.google.com/search?q=${encodeURIComponent(
                `site:${find.site} ${typed && !looksLikeHandle(typed) ? typed : ''}`.trim(),
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              Not sure of the username? Look it up on Google
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}
        </p>

        {message ? (
          <Alert variant="destructive" aria-live="polite">
            <AlertCircle aria-hidden />
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}

        {hits ? (
          <ul className="bg-card divide-y rounded-lg border" aria-live="polite">
            {hits.length === 0 ? (
              <li className="text-muted-foreground px-4 py-3 text-[13px]">
                No profiles found for “{searched}”. Try another name, or paste the profile link.
              </li>
            ) : (
              hits.map((hit) => (
                <li key={hit.externalId}>
                  <button
                    type="button"
                    onClick={() => pick(hit)}
                    className="hover:bg-secondary flex w-full items-center gap-3 px-4 py-2.5 text-left"
                  >
                    <Avatar url={hit.profilePictureUrl} name={hit.displayName ?? hit.username} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {hit.displayName ?? hit.username}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        @{hit.username}
                        {hit.followers !== null
                          ? ` · ${compact.format(hit.followers)} ${followersLabel}`
                          : ''}
                      </span>
                    </span>
                    <span className="text-primary text-[13px] font-medium">Choose</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>

      {choice ? (
        <form action={addFormAction} className="space-y-5">
          <input type="hidden" name="platform" value={platform} />
          <input
            type="hidden"
            name="handle"
            value={choice.checked ? choice.handle : (choice.raw ?? choice.handle)}
          />
          {choice.externalId ? (
            <input type="hidden" name="externalId" value={choice.externalId} />
          ) : null}
          <input type="hidden" name="displayName" value={choice.displayName ?? ''} />

          <ChosenProfile choice={choice} platform={platform} checking={searching} />

          <div className="space-y-2">
            <p className="text-sm font-medium">3. Why do you track it?</p>
            <div className="flex flex-wrap gap-2">
              {BUSINESS_ROLES.map((role) => (
                <label
                  key={role}
                  className="has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:checked]:ring-primary bg-card hover:bg-secondary inline-flex h-9 cursor-pointer items-center rounded-md border px-3 text-[13px] has-[:checked]:font-medium has-[:checked]:ring-1"
                >
                  <input
                    type="radio"
                    name="businessRole"
                    value={role}
                    defaultChecked={role === 'competitor'}
                    className="sr-only"
                  />
                  {BUSINESS_ROLE_LABELS[role]}
                </label>
              ))}
            </div>
          </div>

          <div className="max-w-xs space-y-1.5">
            <Label htmlFor="add-country">
              Country <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <NativeSelect id="add-country" name="countryCode" defaultValue="">
              <option value="">No country</option>
              {countries.map((country) => (
                <option key={country.value} value={country.value}>
                  {country.label}
                </option>
              ))}
            </NativeSelect>
          </div>

          {added.status === 'error' && added.message ? (
            <Alert variant="destructive" role="alert">
              <AlertCircle aria-hidden />
              <AlertDescription>{added.message}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <SubmitButton size="lg" pendingLabel="Adding…">
              Start tracking @{choice.handle}
            </SubmitButton>
            <p className="text-muted-foreground text-xs">
              {ready[platform]
                ? 'Scopie reads it within 15 minutes, then once a day. History starts today; Scopie never invents numbers for days it didn’t observe.'
                : 'It is saved now and read as soon as the setup above is done. History starts from that first read.'}
            </p>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Avatar({ url, name }: { url?: string | null; name: string }) {
  if (!url) {
    return (
      <span
        aria-hidden
        className="bg-muted text-muted-foreground inline-flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-medium uppercase"
      >
        {name.slice(0, 1)}
      </span>
    );
  }
  return (
    // Profile pictures come from the platform's own image server, shown as-is.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      className="bg-muted size-9 shrink-0 rounded-full object-cover"
    />
  );
}

function ChosenProfile({
  choice,
  platform,
  checking,
}: {
  choice: Choice;
  platform: PublicProfilePlatform;
  checking: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-secondary/40 space-y-3 rounded-lg border p-4" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar url={choice.pictureUrl} name={choice.displayName ?? choice.handle} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{choice.displayName ?? `@${choice.handle}`}</p>
          {choice.displayName ? (
            <p className="text-muted-foreground text-[13px]">@{choice.handle}</p>
          ) : null}
        </div>
        {checking ? (
          <Badge variant="muted">
            <Loader2 className="size-3 animate-spin" aria-hidden /> Checking…
          </Badge>
        ) : choice.checked ? (
          <Badge variant="success">
            <Check className="size-3" aria-hidden /> Found on{' '}
            {PUBLIC_PLATFORM_OPTIONS.find((o) => o.value === platform)?.label}
          </Badge>
        ) : (
          <Badge variant="muted">Not checked yet</Badge>
        )}
      </div>
      {choice.biography ? (
        <p className="line-clamp-3 text-[13px] whitespace-pre-line">{choice.biography}</p>
      ) : null}
      {choice.followers !== undefined || choice.postsTotal !== undefined ? (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
          {choice.followers !== undefined ? (
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">
                {platform === 'youtube' ? 'Subscribers' : 'Followers'}
              </dt>
              <dd className="font-medium tabular-nums">
                {choice.followers === null ? 'not public' : nf.format(choice.followers)}
              </dd>
            </div>
          ) : null}
          {choice.postsTotal !== undefined ? (
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">
                {platform === 'youtube' ? 'Videos' : 'Posts'}
              </dt>
              <dd className="font-medium tabular-nums">
                {choice.postsTotal === null ? 'not public' : nf.format(choice.postsTotal)}
              </dd>
            </div>
          ) : null}
          {choice.website ? (
            <div className="flex min-w-0 gap-1.5">
              <dt className="text-muted-foreground">Website</dt>
              <dd className="truncate">{choice.website}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <button
        type="button"
        className="text-primary inline-flex items-center gap-1 text-left text-[13px] hover:underline"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        What Scopie can and can’t see for this profile
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="grid gap-4 text-[13px] sm:grid-cols-2">
          <ul className="space-y-1">
            {TRACKABLE[platform].map((item) => (
              <li key={item} className="flex gap-2">
                <Check className="text-success mt-0.5 size-3.5 shrink-0" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
          <ul className="text-muted-foreground space-y-1">
            {NOT_PUBLIC[platform].map((item) => (
              <li key={item} className="flex gap-2">
                <Minus className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {item} (not public)
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
