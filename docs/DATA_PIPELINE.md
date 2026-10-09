# Scopie — Data pipeline

> Status: built in Phase 2; public profile collection added in Phase 3. Last updated: 2026-10-07

How social data gets into Scopie, how it is kept honest, and what happens when something fails.
Table details are in [DATABASE.md](DATABASE.md), metric definitions in [METRICS.md](METRICS.md),
platform setup in [API_INTEGRATIONS.md](API_INTEGRATIONS.md).

## 1. One path for every source

```
Business Discovery ──► Instagram public collector ──┐  (live_public)
Meta Graph insights ─► Instagram / Facebook adapter ┤  (live_connected)
CSV file ────────────► import parser ───────────────┼──► ingest() ──► posts + metric snapshots
DEMO generator ──────► lib/demo/generate.ts ────────┘  (demo)  │
                                                               └──► the database checks the source again
```

Scopie reads profiles in two independent ways:

| Mode          | Profiles                                                  | Authorization                                                                           | Code                                                    |
| ------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Public**    | Any profile: competitors, industry, creators, CANNA's own | None from the owner; a viewer account per org (Instagram) or a server API key (YouTube) | `PublicProfileCollector`, `lib/sync/public-jobs.ts`     |
| **Connected** | CANNA's own profiles only (`business_role = owned`)       | OAuth by someone who manages the account                                                | `PrivateDataAdapter`, the connected jobs in `engine.ts` |

A connected Instagram profile is observed both ways, so CANNA can be compared with competitors on
the same public numbers.

Every source produces the same normalized records (`lib/platforms/types.ts`) and writes them
through one function, `ingest()` in `lib/ingest/ingest.ts`. It applies the same rules to all of them:

- only metrics from the dictionary, and never derived metrics such as engagement rate;
- a value is present exactly when its availability is `available`; withheld or missing numbers are
  stored as `not_permitted`, `not_public`, `hidden_by_owner`, `not_applicable`, `pending` or `error`
  with no value, never as 0;
- no negative or infinite numbers, no post published after it was captured;
- exact duplicates (same post, metric, period, date and capture time) are skipped, so retries are safe.

The database repeats the source rules as a second line of defence (`check_fact_source` and the guard
triggers in the data pipeline migration):

| Source (UI label)            | Who may write it                      | Extra rule                                                  |
| ---------------------------- | ------------------------------------- | ----------------------------------------------------------- |
| `live_public` (PUBLIC)       | The sync worker only                  | The platform must have a public collector (Instagram today) |
| `live_connected` (CONNECTED) | The sync worker only                  | The account must be connected                               |
| `imported` (IMPORTED)        | Owners and admins, through CSV import | Must belong to an import batch                              |
| `estimated` (ESTIMATED)      | Nobody yet                            | Reserved; never mixed with live values                      |
| `demo` (DEMO)                | The seed script only                  | Only in a demo organization                                 |

A demo organization holds only `demo` or `imported` data. Signed-in users can write only `imported`.

## 2. Collectors and adapters

Both kinds turn one platform's API into normalized records and never touch the database, so each is
tested against saved responses. `lib/platforms/registry.ts` builds them (`createPublicCollector`,
`createAdapter`) and lists which platforms have each (`PUBLIC_DATA_PLATFORMS`, `CONNECTED_PLATFORMS`).

### 2.1 Public collectors

A `PublicProfileCollector` (`lib/platforms/types.ts`) reads a profile by its handle with an
app-level credential, never the profile owner's token. It has three calls: `lookupProfile` (the
add-profile preview), `observeProfile` (profile fields, totals and the newest page of posts) and
`listPosts` (older pages). It also reports `appUsage`, the share of Meta's hourly limit used so far.

- **Instagram** (`lib/platforms/meta/business-discovery.ts`): Business Discovery through the
  organization's viewer account (see [PUBLIC_DATA_SETUP.md](PUBLIC_DATA_SETUP.md)). Profile: username,
  bio, website, followers (`followers`) and post count (`posts_total`); display name and profile
  picture are requested and dropped if Meta refuses them. Posts, 25 per page: link, caption, time,
  type, likes, comments and Reel views. A missing like count is stored as `hidden_by_owner`; views on a
  non-Reel post as `not_applicable`. Reach, saves and shares are not requested.
- **YouTube** (`lib/platforms/youtube/public.ts`): the Data API v3 with a server API key, no viewer
  and no OAuth (see [API_INTEGRATIONS.md](API_INTEGRATIONS.md) §4b). Profile: title, description,
  subscribers (`followers`, rounded by YouTube), video count (`posts_total`) and lifetime channel views.
  Videos, 50 per page from the uploads playlist: link, title, description, time, views, likes and
  comments. Hidden likes and turned-off comments are stored as `hidden_by_owner`; upcoming premieres
  are skipped. It reports no `appUsage`; a quota error pauses the run for an hour.
- Personal, unknown and age-restricted accounts can't be read; the collector raises
  `profile_not_found` and nothing is stored.

### 2.2 Private data adapters

An adapter (`PrivateDataAdapter`) reads an account its owner connected. Platform field names stop at the adapter; the
mapping from platform metric to Scopie metric lives in `PLATFORM_METRIC_MAP` (`lib/metrics/registry.ts`),
mirrored in the `platform_metric_map` table.

- **Instagram** (`lib/platforms/meta/instagram.ts`): followers, follower gains, reach, views, profile
  views and interactions per day; posts with reach, views, likes, comments, shares, saves,
  interactions, and for reels watch time (converted from milliseconds to seconds).
- **Facebook Pages** (`lib/platforms/meta/facebook.ts`): followers, reach and engagements per day;
  posts with reach, impressions, reactions, comments, shares and clicks.
- **CSV import** (`lib/imports/`): account metrics by day, or posts with their metrics. This is how
  LinkedIn, TikTok and other platforms without a connector get data for now.

When one insights metric fails (for example a permission is missing), the adapter retries the others
one by one, so a single missing permission marks one metric `not_permitted` instead of losing the day.

## 3. Sync jobs

The worker queues whatever is due every 15 minutes (`enqueueDueJobs` in `lib/sync/scheduler.ts`) in
two passes. Constants are in `lib/sync/schedule.ts`.

### 3.1 Public jobs

Every active profile with a handle, on a platform with a public collector, gets three jobs, as long as
its platform's credential exists: a chosen viewer account for Instagram, `YOUTUBE_API_KEY` on the
server for YouTube. DEMO profiles never get them.

| Job                                               | How often  | Page limit | What it does                                                                                                                                                                                       |
| ------------------------------------------------- | ---------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily public observation (`public_profile_daily`) | Every 24 h | 1          | One observation: followers, post count, the newest 25 posts, and the profile fields (a new profile snapshot only if they changed). Sets `first_observed_at` once and `last_observed_at` each time. |
| Public post metrics (`public_posts_refresh`)      | Every 3 h  | 4          | Pages through posts published in the last 31 days. Stores a snapshot for a post when it passes a capture age (1, 2, 3, 7, 14 or 30 days) since its last public snapshot.                           |
| Public post history (`public_backfill`)           | Every hour | 20 in all  | Pages back once, up to 12 months or 20 pages, saving its place after each page. Stores each post found with its current totals. Then records `earliest_post_at` and stops for good.                |

A post's metrics are stored the first time Scopie sees it publicly, then only at capture ages. The
backfill stores metrics only for posts never seen before.

**Earliest post.** When the backfill finishes, `social_accounts.earliest_post_at` is set to the
oldest stored post. From that date on, Scopie holds every post the profile published, so posting
frequency is only counted after it. The profile page shows this as a coverage line, for example
"Observed since 7 Oct 2026; posts complete back to 3 Mar 2025."

**Budget.** About 30 profiles cost about 30 daily calls, about 240 refresh calls and a one-off
backfill. Meta's limit for Business Discovery is about 200 calls per hour per app user. Add-profile
previews are capped at 30 per organization per hour (`public_profile_lookups`), so a busy form can't
use up what syncs need.

### 3.2 Connected jobs

Each active account linked to an active connection has four jobs.

| Job                   | How often  | What it does                                                                                                                |
| --------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| Daily account metrics | Every 24 h | Reads complete days only (up to yesterday). First run: 28 days. Later runs re-read the last 3 days, which platforms revise. |
| New posts             | Every 6 h  | Reads newest posts until 3 days before the newest one already stored. Measures each new post right away.                    |
| Post metrics refresh  | Every hour | Takes a snapshot when a post passes 1, 2, 3, 7, 14, 30 or 90 days old. Up to 200 posts per run.                             |
| History backfill      | Every hour | Pages back through older posts, 5 pages per run, saving its place after each page. Stops when there are no more.            |

An owner or admin can press **Sync now** on a profile page. It calls `request_sync(account, job)`.
Without a job it queues the daily public observation on a platform with public data (Instagram), and
"New posts" otherwise. Only one run per account and job can be queued or running at a time (a partial
unique index).

**Capture times.** Every value in one write shares its capture time, and each post snapshot stores the
post's age in hours, so "reach at 7 days" can be compared across posts (`post_metrics_at_age` view).
Posts found by a backfill get one lifetime snapshot at their current age. `posts.first_fetched_at`
records when Scopie first saw a post, so a post that was already old when found can be told apart.

**Report dates.** Meta reports a daily value with an `end_time` at the end of the day in Pacific time;
Scopie dates it by `end_time` minus 12 hours, which always lands on the right calendar day. Each
platform's reporting timezone is stored in `platforms.reporting_timezone`.

**Running it.** In production the Trigger.dev task `scopie-scheduled-sync` (`trigger/sync.ts`) runs
every 15 minutes. Without Trigger.dev, `pnpm sync:worker --watch` does the same from any server.
Both need the service role key and the encryption key; neither runs inside the web app.

## 4. When things go wrong

| What happened                                          | What Scopie does                                                                                                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meta rejects the token (expired, revoked)              | Marks the connection and its accounts "Needs reconnect" and stops. Connecting again with the same login restores it.                                                         |
| Meta rejects the viewer account's token (public job)   | Marks the viewer's connection "Needs reconnect" and fails the run with `viewer_auth`. The tracked profile itself is not marked; Settings → Public data asks for a reconnect. |
| `X-App-Usage` reaches 80% (public job)                 | Stops the run (`usage_paused`), keeps what was saved, and waits an hour before that job runs again. The rest of that pass skips all public jobs; connected jobs still run.   |
| A username now belongs to a different account          | Compares the account id Meta returns with the one first observed. If they differ, fails with `profile_changed` and stores nothing, so two accounts' history is never mixed.  |
| A profile can't be read (personal, unknown, age-gated) | Fails with `profile_not_found` and stores nothing.                                                                                                                           |
| Rate limit                                             | Stops the run, keeps what was saved, and waits for the time Meta asks for (default 15 minutes).                                                                              |
| A server error or network failure                      | Retries the request 3 times with growing waits, then fails the run.                                                                                                          |
| Repeated failures                                      | Waits 15 min, 30, 60 … up to 24 h between attempts. After 3 failures in a row a connected account shows "Sync error".                                                        |
| One post's metrics fail                                | Records it as a warning on the run and carries on with the other posts.                                                                                                      |
| A worker dies mid-run                                  | Runs stuck "running" for over an hour are marked failed and the job is queued again.                                                                                         |

A failed observation is a failed `sync_runs` row. Nothing is written for that day, so charts show a
gap, never a zero or a repeated value.

Every run is listed under **Settings → Connections → Sync health** and on the account page, with what
it processed and the last error. Raw API responses are kept for 30 days for debugging (server only).
Tokens and secrets are removed from every logged URL and message (`lib/platforms/http.ts`).

## 5. Tokens

The viewer account is a connection asset like any other: public jobs use the token of the Facebook
Page its Instagram account is linked to (`loadPublicContext` in `lib/sync/credentials.ts`). It is
decrypted only in the worker and in the add-profile preview on the server, never sent to the browser
or logged.

The OAuth callback exchanges Meta's code for a long-lived user token (about 60 days) and reads one
Page token per Facebook Page, which does not expire while the user keeps their Page role. Instagram
accounts use their Page's token. Tokens are encrypted with AES-256-GCM using `SCOPIE_ENCRYPTION_KEY`
before they reach the database, live in `connection_credentials` which no user role can read, and are
decrypted only in the worker's memory. Disconnecting revokes the grant at Meta (best effort), deletes
the tokens and stops syncing; data already collected stays, labelled with its source.

## 6. CSV import

**Accounts → Import CSV** takes a file of up to 5 MB and 5,000 rows. Templates and example files are on
that page.

- Empty cells mean "not provided" and are not stored; `0` is stored as a real zero.
- Numbers must be plain (`1234` or `12.5`); `1,234` is refused rather than guessed.
- A date alone for a post is read as 12:00 UTC. `captured_at` defaults to the time of import and may
  be given per row, so one file can carry several snapshots of the same post.
- Bad rows are skipped with their row number; the rest are imported. Re-importing the same file adds
  nothing new.
- Common export headers ("Post link", "Clicks", "Reposts", "Impressions") are recognised.

Each import creates an `import_batches` row, so every imported number can be traced to its file.

## 7. DEMO data

`pnpm db:seed` generates fictional posts and metrics for every active profile in the demo
organization, written through `ingest()` with source `demo`. The database refuses `demo` rows anywhere
except a demo organization, and every demo post's caption starts with "DEMO post".

- **Own profiles** get connected-style data: daily account metrics and post insights.
- **Public profiles** (five fictional Instagram profiles: three competitors, an industry account and
  a creator, all named "(DEMO)") get only what Business Discovery would give: one follower observation a day, likes
  (hidden for some profiles), comments and Reel views. Private metrics are never generated for them,
  not even as DEMO data. Each gets `first_observed_at`, `last_observed_at`, `earliest_post_at` and two
  DEMO profile snapshots, so the profile page can show a change.

The scheduler never queues public jobs for DEMO profiles, and the add-profile preview is switched off
in a demo organization.
