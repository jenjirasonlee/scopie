# Scopie — Data pipeline

> Status: built in Phase 2. Last updated: 2026-10-07

How social data gets into Scopie, how it is kept honest, and what happens when something fails.
Table details are in [DATABASE.md](DATABASE.md), metric definitions in [METRICS.md](METRICS.md),
platform setup in [API_INTEGRATIONS.md](API_INTEGRATIONS.md).

## 1. One path for every source

```
Meta Graph API ──► Instagram / Facebook adapter ─┐
CSV file ────────► import parser ────────────────┼──► ingest() ──► posts + metric snapshots
DEMO generator ──► lib/demo/generate.ts ─────────┘        │
                                                          └──► the database checks the source again
```

Every source produces the same normalized records (`lib/platforms/types.ts`) and writes them
through one function, `ingest()` in `lib/ingest/ingest.ts`. It applies the same rules to all of them:

- only metrics from the dictionary, and never derived metrics such as engagement rate;
- a value is present exactly when its availability is `available`; withheld or missing numbers are
  stored as `not_permitted`, `pending` or `error` with no value, never as 0;
- no negative or infinite numbers, no post published after it was captured;
- exact duplicates (same post, metric, period, date and capture time) are skipped, so retries are safe.

The database repeats the source rules as a second line of defence (`check_fact_source` and the guard
triggers in the data pipeline migration):

| Source (UI label)      | Who may write it                      | Extra rule                         |
| ---------------------- | ------------------------------------- | ---------------------------------- |
| `authenticated` (Live) | The sync worker only                  | The account must be connected      |
| `public` (Public)      | The sync worker only                  | Reserved for competitor data later |
| `imported` (Imported)  | Owners and admins, through CSV import | Must belong to an import batch     |
| `manual` (Manual)      | Owners and admins                     | —                                  |
| `demo` (DEMO)          | The seed script only                  | Only in a demo organization        |

## 2. Adapters

An adapter (`PrivateDataAdapter`) turns one platform's API into normalized records and never touches the
database, so each is tested against saved responses. Platform field names stop at the adapter; the
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

Each connected, active, non-competitor account has four jobs. The worker queues whatever is due
every 15 minutes (`lib/sync/scheduler.ts`); constants are in `lib/sync/schedule.ts`.

| Job                   | How often  | What it does                                                                                                                |
| --------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| Daily account metrics | Every 24 h | Reads complete days only (up to yesterday). First run: 28 days. Later runs re-read the last 3 days, which platforms revise. |
| New posts             | Every 6 h  | Reads newest posts until 3 days before the newest one already stored. Measures each new post right away.                    |
| Post metrics refresh  | Every hour | Takes a snapshot when a post passes 1, 2, 3, 7, 14, 30 or 90 days old. Up to 200 posts per run.                             |
| History backfill      | Every hour | Pages back through older posts, 5 pages per run, saving its place after each page. Stops when there are no more.            |

A manager can press **Sync now** on an account page, which queues the "New posts" job immediately.
Only one run per account and job can be queued or running at a time (a partial unique index).

**Capture times.** Every value in one write shares its capture time, and each post snapshot stores the
post's age in hours, so "reach at 7 days" can be compared across posts (`post_metrics_at_age` view).
Posts found by the backfill get one lifetime snapshot at their current age.

**Report dates.** Meta reports a daily value with an `end_time` at the end of the day in Pacific time;
Scopie dates it by `end_time` minus 12 hours, which always lands on the right calendar day. Each
platform's reporting timezone is stored in `platforms.reporting_timezone`.

**Running it.** In production the Trigger.dev task `scopie-scheduled-sync` (`trigger/sync.ts`) runs
every 15 minutes. Without Trigger.dev, `pnpm sync:worker --watch` does the same from any server.
Both need the service role key and the encryption key; neither runs inside the web app.

## 4. When things go wrong

| What happened                             | What Scopie does                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Meta rejects the token (expired, revoked) | Marks the connection and its accounts "Needs reconnect" and stops. Connecting again with the same login restores it. |
| Rate limit                                | Stops the run, keeps what was saved, and waits for the time Meta asks for (default 15 minutes).                      |
| A server error or network failure         | Retries the request 3 times with growing waits, then fails the run.                                                  |
| Repeated failures                         | Waits 15 min, 30, 60 … up to 24 h between attempts. After 3 failures in a row the account shows "Sync error".        |
| One post's metrics fail                   | Records it as a warning on the run and carries on with the other posts.                                              |
| A worker dies mid-run                     | Runs stuck "running" for over an hour are marked failed and the job is queued again.                                 |

Every run is listed under **Settings → Connections → Sync health** and on the account page, with what
it processed and the last error. Raw API responses are kept for 30 days for debugging (server only).
Tokens and secrets are removed from every logged URL and message (`lib/platforms/http.ts`).

## 5. Tokens

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

`pnpm db:seed` generates fictional posts and metrics for the demo organization's own accounts, written
through `ingest()` with source `demo`. The database refuses `demo` rows anywhere except a demo
organization, and every demo post's caption starts with "DEMO post".
